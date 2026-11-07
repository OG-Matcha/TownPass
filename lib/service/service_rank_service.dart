import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_edge_ai/flutter_edge_ai.dart';
import 'package:flutter_edge_ai_litertlm/flutter_edge_ai_litertlm.dart';
import 'package:get/get.dart';
import 'package:path_provider/path_provider.dart';
import 'package:town_pass/page/city_service/model/my_service_model.dart';
import 'package:town_pass/util/semantic/service_ranker.dart';

/// 向量模型的準備狀態。網頁端只在 [ready] 時才拿得到語意分數，其餘狀態一律退回規則搜尋。
enum ServiceRankStatus { idle, preparing, ready, failed }

/// 網頁（handler）用的最小介面；測試時換成假的。
abstract class ServiceRanker {
  ServiceRankStatus get status;

  /// 每個服務的相似度；還沒準備好時回 null（不丟例外）。
  Future<Map<String, double>?> rank(String query, {Set<String>? ids});
}

/// 模型來源資訊。README 的「裝置端 AI 揭露」與這裡一致；換模型時兩邊一起改。
abstract final class ServiceRankModel {
  static const name = 'EmbeddingGemma 2 Text 270M';
  static const repo = 'litert-community/embeddinggemma-2-text-270m-litert-lm';
  static const revision = '9be6e8b90982095dc05c2bd162e4b954ee4dbac7';
  static const sha256 =
      '2d079ee2f6f066b1f368e8d7c819f55214eaef1d0513b312321901f30ab286fb';
  static const assetPath = 'assets/models/embeddinggemma-2-text-270m.litertlm';

  /// 安裝到私有目錄的檔名；與 flutter_edge_ai_litertlm 目錄的 installFilename 相同。
  static const installFilename =
      'embeddinggemma-2-text-270m__rev-9be6e8b90982.litertlm';

  /// 文件與問題的向量用法。預設兩邊都用「句子相似度」（比對兩句短話的意思，兩邊對稱）；
  /// 改了任何一項都會讓快取鍵變動。實際選哪種由 tool/semantic_search 的量測決定。
  static const docTask = TaskType.sentenceSimilarity;
  static const queryTask = TaskType.sentenceSimilarity;

  static String idFor({TaskType doc = docTask, TaskType query = queryTask}) =>
      'embeddinggemma-2-text-270m@${revision.substring(0, 12)}|doc=${doc.name}|query=${query.name}';

  static String get id => idFor();
}

/// 把 flutter_edge_ai 的 embedder 包成 [TextEmbedder]。
class EdgeAiTextEmbedder implements TextEmbedder {
  EdgeAiTextEmbedder(
    this._model, {
    this.docTask = ServiceRankModel.docTask,
    this.queryTask = ServiceRankModel.queryTask,
  });

  final EmbeddingModel _model;
  final TaskType docTask;
  final TaskType queryTask;

  @override
  String get modelId => ServiceRankModel.idFor(doc: docTask, query: queryTask);

  @override
  Future<List<double>> embedDocument(String text) =>
      _model.embed(EmbeddingInput.text(text), taskType: docTask);

  @override
  Future<List<double>> embedQuery(String text) =>
      _model.embed(EmbeddingInput.text(text), taskType: queryTask);

  /// 同一個模型、不同的向量用法（量測腳本比較用，不另外載入模型）。
  EdgeAiTextEmbedder variant({
    required TaskType docTask,
    required TaskType queryTask,
  }) => EdgeAiTextEmbedder(_model, docTask: docTask, queryTask: queryTask);

  Future<void> close() => _model.close();
}

/// 套件只需初始化一次（重試準備時不重複）。
bool _edgeAiInitialized = false;

/// 「找服務」的語意比對服務。
///
/// 全程裝置端：模型檔隨 App 打包（assets/models/），第一次啟動時複製到 App 私有目錄再載入，
/// 不連網、不下載。準備工作在背景進行（[init] 立刻回傳），沒準備好或失敗時 [rank] 回 null，
/// 網頁端就用原本的規則搜尋。使用者看不到任何錯誤訊息。
class ServiceRankService extends GetxService implements ServiceRanker {
  /// 測試用：直接給假的 embedder，略過模型安裝。
  ServiceRankService({
    TextEmbedder? embedderForTest,
    Future<List<ServiceDoc>> Function()? docsLoader,
    File? indexFile,
  }) : _testEmbedder = embedderForTest,
       _docsLoader = docsLoader ?? loadServiceDocs,
       _indexFileOverride = indexFile;

  final TextEmbedder? _testEmbedder;
  final Future<List<ServiceDoc>> Function() _docsLoader;
  final File? _indexFileOverride;

  final Rx<ServiceRankStatus> _status = ServiceRankStatus.idle.obs;
  ServiceRankEngine? _engine;
  EdgeAiTextEmbedder? _edgeEmbedder;
  Future<void>? _preparing;

  /// 最近一次準備是否用到快取、失敗的錯誤型別（量測與測試用，不含任何使用者資料）。
  bool? lastUsedCache;
  String? lastFailure;

  @override
  ServiceRankStatus get status => _status.value;

  /// 啟動背景準備，不等它完成（App 啟動不被 165 MB 的模型拖慢）。
  ServiceRankService init() {
    unawaited(prepare());
    return this;
  }

  /// 準備模型與服務向量。重複呼叫會共用同一個進行中的工作；失敗後再呼叫會重試。
  Future<void> prepare() {
    final running = _preparing;
    if (running != null && _status.value == ServiceRankStatus.preparing) {
      return running;
    }
    return _preparing = _prepare();
  }

  Future<void> _prepare() async {
    _status.value = ServiceRankStatus.preparing;
    try {
      final TextEmbedder embedder = _testEmbedder ?? await _loadRealEmbedder();
      _sharedEmbedder = embedder;
      final docs = await _docsLoader();
      final key = serviceIndexCacheKey(docs: docs, modelId: embedder.modelId);
      final store = ServiceIndexStore(
        _indexFileOverride ?? await _defaultIndexFile(),
      );

      var index = await store.load(expectedKey: key);
      lastUsedCache = index != null;
      if (index == null) {
        index = await ServiceRankEngine.buildIndex(
          embedder: embedder,
          docs: docs,
        );
        try {
          await store.save(index);
        } catch (e) {
          // 存不下快取不影響使用，只是下次啟動要重算
          debugPrint('service_rank: 快取寫入失敗：$e');
        }
      }
      _engine = ServiceRankEngine(embedder: embedder, index: index);
      lastFailure = null;
      _status.value = ServiceRankStatus.ready;
    } catch (e) {
      lastFailure = e.runtimeType.toString();
      _engine = null;
      _status.value = ServiceRankStatus.failed;
      // 只記錯誤型別，不記使用者的話
      debugPrint('service_rank: 準備失敗（${e.runtimeType}），搜尋退回規則比對');
    }
  }

  Future<TextEmbedder> _loadRealEmbedder() async {
    if (!_edgeAiInitialized) {
      await FlutterEdgeAi.initialize(
        embeddingBackends: [LiteRtEmbeddingBackend()],
      );
      _edgeAiInitialized = true;
    }
    final installed = await FlutterEdgeAi.isModelInstalled(
      ServiceRankModel.installFilename,
    );
    if (!installed || !FlutterEdgeAi.hasActiveEmbedder()) {
      // 第一次啟動：把打包在 App 裡的模型複製到私有目錄（Android／iOS 為串流複製，不會整顆讀進記憶體）
      await FlutterEdgeAi.installEmbedder()
          .modelFromAsset(
            ServiceRankModel.assetPath,
            filename: ServiceRankModel.installFilename,
          )
          .install();
    }
    final model = await FlutterEdgeAi.getActiveEmbedder();
    return _edgeEmbedder = EdgeAiTextEmbedder(model);
  }

  Future<File> _defaultIndexFile() async {
    final dir = await getApplicationSupportDirectory();
    return File('${dir.path}/service_rank/index.json');
  }

  @override
  Future<Map<String, double>?> rank(String query, {Set<String>? ids}) async {
    final engine = _engine;
    if (engine == null || _status.value != ServiceRankStatus.ready) return null;
    return engine.rank(query, ids: ids);
  }

  /// 已載入的向量模型（真模型或測試用的假模型），給共用向量服務 `embed` handler 用：
  /// 網頁（捷運陪伴）與找服務共用同一個實例，App 裡只有一顆向量模型。準備好之前為 null。
  TextEmbedder? get sharedEmbedder => _sharedEmbedder;
  TextEmbedder? _sharedEmbedder;

  /// 真實模型的 embedder，只給 tool/semantic_search/eval_main.dart 量測用（測試用的假 embedder 時為 null）。
  EdgeAiTextEmbedder? get edgeEmbedder => _edgeEmbedder;

  @override
  void onClose() {
    unawaited(_edgeEmbedder?.close());
    super.onClose();
  }
}

/// 組出要比對的文字：App 的服務清單（名稱＋說明）＋團隊整理的例句。
///
/// 例句來自 tool/semantic_search/phrases.json（打包成 asset）。清單裡有、例句檔沒有的服務，
/// 仍會用名稱與說明比對；例句檔裡有、清單沒有的 id 會被忽略。
Future<List<ServiceDoc>> loadServiceDocs() async {
  final raw = jsonDecode(
    await rootBundle.loadString('tool/semantic_search/phrases.json'),
  ) as Map<String, dynamic>;
  return buildServiceDocs(phrases: raw['services'] as Map<String, dynamic>);
}

/// [loadServiceDocs] 的純函式部分，方便測試。
List<ServiceDoc> buildServiceDocs({required Map<String, dynamic> phrases}) {
  final docs = <ServiceDoc>[];
  for (final id in MyServiceItemId.values) {
    final item = id.item;
    final texts = <String>['${item.title}：${item.description}'];
    final entry = phrases[id.name];
    if (entry is Map && entry['phrases'] is List) {
      for (final p in entry['phrases'] as List) {
        if (p is String && p.trim().isNotEmpty) texts.add(p.trim());
      }
    }
    docs.add(ServiceDoc(id: id.name, texts: texts));
  }
  return docs;
}
