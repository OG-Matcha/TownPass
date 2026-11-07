import 'package:flutter/foundation.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:get/get.dart';
import 'package:town_pass/service/service_rank_service.dart';
import 'package:town_pass/util/semantic/service_ranker.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';

/// 共用向量服務：讓微服務網頁用 App 已載入的 EmbeddingGemma 2（與「找服務」同一顆、同一個實例），
/// 網頁不必再自己帶一顆向量模型。捷運陪伴的語音指令與目的地語意搜尋用這個。
///
/// 網頁 → App：`{ name: 'embed', data: { texts: ['我到了', ...], kind: 'query' | 'document', rid?: 'e7' } }`
/// App → 網頁：`{ name: 'embed', data: { ok: true, rid, vectors: [[...], ...], dim, model } }`
///           或 `{ name: 'embed', data: { ok: false, rid, reason } }`
///
/// `vectors` 與 `texts` 一一對應、已正規化（內積 = 餘弦相似度）。`kind` 決定模型的任務前綴
/// （目前兩者都是 sentence similarity，與找服務一致）。
/// `reason` 只會是 `bad_request`、`not_ready`（模型沒準備好或載入失敗）、`error`。網頁收到 `ok: false` 要退回自己的做法。
///
/// 隱私：文字只在裝置上轉成向量，不送出、不寫入記錄檔。只回應最上層頁面（`isMainFrame`）。
class EmbedMessageHandler extends TPWebMessageHandler {
  EmbedMessageHandler({this._embedder});

  final TextEmbedder? _embedder;

  @override
  String get name => 'embed';

  /// 一次最多幾句（網頁分批送，每批回覆不會太大）。
  static const int maxTexts = 32;

  /// 同一時間只算一批：模型實例是共用的，不讓兩個請求同時進去。
  static Future<void> _queue = Future.value();

  Future<TextEmbedder?> _resolveEmbedder() async {
    final injected = _embedder;
    if (injected != null) return injected;
    if (!Get.isRegistered<ServiceRankService>()) return null;
    final service = Get.find<ServiceRankService>();
    // 找服務在 App 啟動時就在背景載入模型；還在準備就等它（共用同一個工作，不會重複載入）
    if (service.status != ServiceRankStatus.ready) await service.prepare();
    return service.status == ServiceRankStatus.ready
        ? service.sharedEmbedder
        : null;
  }

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage replyWebMessage)? onReply,
  }) async {
    final rid =
        message is Map && (message['rid'] is num || message['rid'] is String)
        ? message['rid']
        : null;
    Map<String, Object?> fail(String reason) => {
      'ok': false,
      'rid': rid,
      'reason': reason,
    };

    final Map<String, Object?> data;
    final request = _parse(message, isMainFrame: isMainFrame);
    if (request == null) {
      data = fail('bad_request');
    } else {
      final done = _queue.then((_) => _embed(request, rid: rid, fail: fail));
      _queue = done.then((_) {}, onError: (_) {});
      data = await done;
    }
    onReply?.call(replyWebMessage(data: data));
  }

  ({List<String> texts, bool isQuery})? _parse(
    Object? message, {
    required bool isMainFrame,
  }) {
    if (!isMainFrame || message is! Map) return null;
    final texts = message['texts'];
    final kind = message['kind'] ?? 'query';
    if (kind != 'query' && kind != 'document') return null;
    if (texts is! List || texts.isEmpty || texts.length > maxTexts) return null;
    final out = <String>[];
    for (final t in texts) {
      if (t is! String) return null;
      final s = t.trim();
      if (s.isEmpty || s.length > maxQueryChars) return null;
      out.add(s);
    }
    return (texts: out, isQuery: kind == 'query');
  }

  Future<Map<String, Object?>> _embed(
    ({List<String> texts, bool isQuery}) request, {
    required Object? rid,
    required Map<String, Object?> Function(String reason) fail,
  }) async {
    final embedder = await _resolveEmbedder();
    if (embedder == null) return fail('not_ready');
    try {
      final vectors = <List<double>>[];
      for (final text in request.texts) {
        final raw = request.isQuery
            ? await embedder.embedQuery(text)
            : await embedder.embedDocument(text);
        // 5 位小數：餘弦相似度誤差 < 1e-4，回覆小一半
        vectors.add([
          for (final x in normalizeVector(raw)) (x * 1e5).roundToDouble() / 1e5,
        ]);
      }
      return {
        'ok': true,
        'rid': rid,
        'vectors': vectors,
        'dim': vectors.first.length,
        'model': embedder.modelId,
      };
    } catch (e) {
      // 只記錯誤型別；錯誤訊息可能帶到使用者輸入，不記
      debugPrint('embed: 向量化失敗（${e.runtimeType}）');
      return fail('error');
    }
  }
}
