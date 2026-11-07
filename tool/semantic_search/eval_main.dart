// 量測用入口：在真機或模擬器上跑正式的 ServiceRankService（真模型、asset 複製、建索引），
// 把 queries.json 每題對 21 個服務的相似度印到 log，供 eval_merge.mjs 與規則分數合併後計算命中率。
//
// 用法見 tool/semantic_search/run_eval.sh。不屬於 App 本體（release 不會用到這個檔案）。
// 只印「題目編號與分數」；題目是公開的測試題，不含任何使用者資料。
import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:town_pass/service/service_rank_service.dart';
import 'package:town_pass/util/semantic/service_ranker.dart';
import 'package:flutter_edge_ai/flutter_edge_ai.dart' show TaskType;

const _queriesJson = String.fromEnvironment('QUERIES_JSON');

void _out(String tag, Object json) => debugPrint('$tag ${jsonEncode(json)}');

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    const MaterialApp(
      home: Scaffold(body: Center(child: Text('semantic eval running'))),
    ),
  );
  try {
    final queries = (jsonDecode(_queriesJson) as List)
        .cast<Map<String, dynamic>>();

    // 1) 正式路徑：asset → 私有目錄 → 載入 → 建索引（或讀快取）
    final service = ServiceRankService();
    final watch = Stopwatch()..start();
    await service.prepare();
    _out('EVAL_PREPARE', {
      'status': service.status.name,
      'ms': watch.elapsedMilliseconds,
      'usedCache': service.lastUsedCache,
      'failure': service.lastFailure,
    });
    if (service.status != ServiceRankStatus.ready) {
      _out('EVAL_DONE', {'ok': false});
      return;
    }

    // 2) 各種向量用法各算一份索引（同一個已載入的模型）
    final base = service.edgeEmbedder!;
    final docs = await loadServiceDocs();
    final variants = <String, EdgeAiTextEmbedder>{
      'sim-sim': base.variant(
        docTask: TaskType.sentenceSimilarity,
        queryTask: TaskType.sentenceSimilarity,
      ),
      'retr-retr': base.variant(
        docTask: TaskType.retrievalDocument,
        queryTask: TaskType.retrievalQuery,
      ),
    };
    for (final entry in variants.entries) {
      final w = Stopwatch()..start();
      final index = await ServiceRankEngine.buildIndex(
        embedder: entry.value,
        docs: docs,
      );
      final buildMs = w.elapsedMilliseconds;
      final engine = ServiceRankEngine(embedder: entry.value, index: index);
      _out('EVAL_VARIANT', {
        'variant': entry.key,
        'buildIndexMs': buildMs,
        'dimension': index.dimension,
      });
      for (final q in queries) {
        final qw = Stopwatch()..start();
        final scores = await engine.rank(q['text'] as String);
        _out('EVAL_Q', {
          'variant': entry.key,
          'id': q['id'],
          'ms': qw.elapsedMilliseconds,
          'scores': scores,
        });
      }
    }
    _out('EVAL_DONE', {'ok': true});
  } catch (e, st) {
    _out('EVAL_ERROR', {
      'type': e.runtimeType.toString(),
      'message': '$e',
      'stack': '$st'.split('\n').take(6).toList(),
    });
    _out('EVAL_DONE', {'ok': false});
  }
}
