import 'package:town_pass/util/semantic/service_ranker.dart';

/// 測試用的假向量模型：把句子的相鄰兩字（bigram）雜湊到 4096 個格子裡計數。
/// 字面重疊越多就越相近，足以驗證資料流與契約；不代表真模型的品質（真模型的命中率在 README 的量測）。
class FakeEmbedder implements TextEmbedder {
  FakeEmbedder({this.id = 'fake@1', this.failOn});

  final String id;
  String? failOn;
  int docCalls = 0;
  int queryCalls = 0;

  List<double> _vec(String text) {
    if (failOn != null && text.contains(failOn!)) throw StateError('boom');
    final v = List<double>.filled(4096, 0);
    final chars = text.runes.toList();
    for (var i = 0; i < chars.length; i++) {
      final a = chars[i];
      final b = i + 1 < chars.length ? chars[i + 1] : 0;
      v[(a * 31 + b) % 4096] += 1;
    }
    return v;
  }

  @override
  String get modelId => id;

  @override
  Future<List<double>> embedDocument(String text) async {
    docCalls++;
    return _vec(text);
  }

  @override
  Future<List<double>> embedQuery(String text) async {
    queryCalls++;
    return _vec(text);
  }
}
