// 單元測試：服務比對的純邏輯。向量模型一律用假的（stub），不載入真模型。
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/util/semantic/service_ranker.dart';

/// 假模型：看句子裡有哪些關鍵字，就在對應的座標軸上放 1。
/// 軸：0=水 1=路燈 2=疫苗 3=書。沒有任何關鍵字的句子是全 0 向量。
class FakeEmbedder implements TextEmbedder {
  FakeEmbedder({this.id = 'fake@1', this.failOn});

  final String id;
  final String? failOn;
  int docCalls = 0;
  int queryCalls = 0;

  static const _axes = {'水': 0, '燈': 1, '疫苗': 2, '書': 3};

  List<double> _vec(String text) {
    if (failOn != null && text.contains(failOn!)) throw StateError('boom');
    final v = List<double>.filled(4, 0);
    _axes.forEach((k, i) {
      if (text.contains(k)) v[i] += 1;
    });
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

const _docs = [
  ServiceDoc(id: 'water', texts: ['用水服務：繳水費', '水管破了', '水費帳單']),
  ServiceDoc(id: 'lamp', texts: ['有話要說：陳情', '路燈壞了']),
  ServiceDoc(id: 'vaccine', texts: ['疫苗預約', '打流感疫苗']),
];

void main() {
  group('fnv1a64Hex（雜湊）', () {
    test('符合 FNV-1a 64 的標準測資', () {
      // 來源：FNV 官方測試向量（draft-eastlake-fnv）
      expect(fnv1a64Hex(utf8.encode('')), 'cbf29ce484222325');
      expect(fnv1a64Hex(utf8.encode('a')), 'af63dc4c8601ec8c');
      expect(fnv1a64Hex(utf8.encode('foobar')), '85944171f73967e8');
    });
  });

  group('serviceIndexCacheKey（快取鍵）', () {
    final base = serviceIndexCacheKey(docs: _docs, modelId: 'm1');

    test('同樣內容得到同樣的鍵', () {
      expect(serviceIndexCacheKey(docs: _docs, modelId: 'm1'), base);
    });
    test('服務順序不同不影響（依 id 排序）', () {
      expect(
        serviceIndexCacheKey(docs: _docs.reversed.toList(), modelId: 'm1'),
        base,
      );
    });
    test('模型身分不同 → 鍵不同', () {
      expect(serviceIndexCacheKey(docs: _docs, modelId: 'm2'), isNot(base));
    });
    test('例句多一句或改一個字 → 鍵不同', () {
      final more = [
        ..._docs,
        const ServiceDoc(id: 'book', texts: ['借書']),
      ];
      expect(serviceIndexCacheKey(docs: more, modelId: 'm1'), isNot(base));
      final edited = [
        const ServiceDoc(id: 'water', texts: ['用水服務：繳水費', '水管破了', '水費單']),
        _docs[1],
        _docs[2],
      ];
      expect(serviceIndexCacheKey(docs: edited, modelId: 'm1'), isNot(base));
    });
    test('格式版本不同 → 鍵不同', () {
      expect(
        serviceIndexCacheKey(docs: _docs, modelId: 'm1', format: 'v2'),
        isNot(base),
      );
    });
    test('邊界：把一句拆成兩句不會撞鍵', () {
      final a = [
        const ServiceDoc(id: 'x', texts: ['ab', 'c']),
      ];
      final b = [
        const ServiceDoc(id: 'x', texts: ['a', 'bc']),
      ];
      expect(
        serviceIndexCacheKey(docs: a, modelId: 'm'),
        isNot(serviceIndexCacheKey(docs: b, modelId: 'm')),
      );
    });
  });

  group('向量運算', () {
    test('正規化後長度為 1', () {
      final v = normalizeVector([3, 4]);
      expect(dotProduct(v, v), closeTo(1, 1e-6));
    });
    test('全 0 向量不會變成 NaN，相似度為 0', () {
      final z = normalizeVector([0, 0, 0]);
      expect(z.every((x) => x == 0), isTrue);
      expect(dotProduct(z, normalizeVector([1, 0, 0])), 0);
    });
    test('長度不同視為不可比，回 0', () {
      expect(
        dotProduct(normalizeVector([1, 0]), normalizeVector([1, 0, 0])),
        0,
      );
    });
  });

  group('ServiceIndex 序列化', () {
    Future<ServiceIndex> build() =>
        ServiceRankEngine.buildIndex(embedder: FakeEmbedder(), docs: _docs);

    test('寫成 JSON 再讀回來，向量完全一致', () async {
      final index = await build();
      final back = ServiceIndex.tryParse(
        jsonDecode(jsonEncode(index.toJson())),
        expectedKey: index.key,
      );
      expect(back, isNotNull);
      expect(back!.dimension, index.dimension);
      expect(back.vectors.keys, index.vectors.keys);
      for (final id in index.vectors.keys) {
        for (var i = 0; i < index.vectors[id]!.length; i++) {
          expect(back.vectors[id]![i], orderedEquals(index.vectors[id]![i]));
        }
      }
    });
    test('鍵不符 → null（要重算）', () async {
      final index = await build();
      expect(
        ServiceIndex.tryParse(index.toJson(), expectedKey: 'another'),
        isNull,
      );
    });
    test('壞資料一律 null，不丟例外', () async {
      final index = await build();
      final good =
          jsonDecode(jsonEncode(index.toJson())) as Map<String, dynamic>;
      expect(ServiceIndex.tryParse(null, expectedKey: index.key), isNull);
      expect(ServiceIndex.tryParse('x', expectedKey: index.key), isNull);
      expect(
        ServiceIndex.tryParse({
          ...good,
          'format': 'old',
        }, expectedKey: index.key),
        isNull,
      );
      expect(
        ServiceIndex.tryParse({
          ...good,
          'dimension': 5,
        }, expectedKey: index.key),
        isNull,
      ); // 位元組數對不上
      expect(
        ServiceIndex.tryParse({
          ...good,
          'services': {
            'water': ['!!!不是base64'],
          },
        }, expectedKey: index.key),
        isNull,
      );
      expect(
        ServiceIndex.tryParse({
          ...good,
          'services': {},
        }, expectedKey: index.key),
        isNull,
      );
    });
  });

  group('ServiceIndexStore（快取檔）', () {
    late Directory dir;
    setUp(() => dir = Directory.systemTemp.createTempSync('rank_store'));
    tearDown(() => dir.deleteSync(recursive: true));

    test('存檔後可讀回；沒有檔案、檔案壞掉、鍵不符都回 null', () async {
      final store = ServiceIndexStore(File('${dir.path}/sub/index.json'));
      final index = await ServiceRankEngine.buildIndex(
        embedder: FakeEmbedder(),
        docs: _docs,
      );
      expect(await store.load(expectedKey: index.key), isNull); // 沒檔案
      await store.save(index);
      expect(await store.load(expectedKey: index.key), isNotNull);
      expect(await store.load(expectedKey: 'other'), isNull);
      expect(
        File('${dir.path}/sub/index.json.tmp').existsSync(),
        isFalse,
      ); // 暫存檔已改名
      File('${dir.path}/sub/index.json').writeAsStringSync('{壞掉');
      expect(await store.load(expectedKey: index.key), isNull);
    });
  });

  group('ServiceRankEngine', () {
    late ServiceRankEngine engine;
    setUp(() async {
      final e = FakeEmbedder();
      engine = ServiceRankEngine(
        embedder: e,
        index: await ServiceRankEngine.buildIndex(embedder: e, docs: _docs),
      );
    });

    test('建索引回報進度，且每句都轉成向量', () async {
      final e = FakeEmbedder();
      final seen = <String>[];
      await ServiceRankEngine.buildIndex(
        embedder: e,
        docs: _docs,
        onProgress: (d, t) => seen.add('$d/$t'),
      );
      expect(seen, ['1/7', '2/7', '3/7', '4/7', '5/7', '6/7', '7/7']);
      expect(e.docCalls, 7);
    });
    test('回傳每個服務例句中最高的相似度', () async {
      final scores = await engine.rank('水管爆了');
      expect(scores['water'], closeTo(1, 1e-3)); // 「水管破了」軸相同
      expect(scores['lamp'], 0);
      expect(scores['vaccine'], 0);
    });
    test('ids 只算指定的服務', () async {
      final scores = await engine.rank('水管爆了', ids: {'water', 'lamp'});
      expect(scores.keys.toSet(), {'water', 'lamp'});
    });
    test('完全對不上的話：全部是 0，不會硬湊出相近的服務', () async {
      final scores = await engine.rank('護照');
      expect(scores.values.every((s) => s == 0), isTrue);
    });
    test('空白或過長的問題丟 ArgumentError', () async {
      expect(() => engine.rank('   '), throwsArgumentError);
      expect(() => engine.rank('水' * (maxQueryChars + 1)), throwsArgumentError);
    });
    test('問題向量維度和索引不同 → StateError', () async {
      final bad = ServiceRankEngine(embedder: _WrongDim(), index: engine.index);
      expect(() => bad.rank('水'), throwsStateError);
    });
    test('模型回傳空向量 → 建索引失敗', () async {
      expect(
        () => ServiceRankEngine.buildIndex(embedder: _Empty(), docs: _docs),
        throwsStateError,
      );
    });
  });
}

class _WrongDim extends FakeEmbedder {
  @override
  Future<List<double>> embedQuery(String text) async => [1, 0];
}

class _Empty extends FakeEmbedder {
  @override
  Future<List<double>> embedDocument(String text) async => [];
}
