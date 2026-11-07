// 單元測試：ServiceRankService（準備流程、快取、失敗降級）與 buildServiceDocs。向量模型用假的。
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/page/city_service/model/my_service_model.dart';
import 'package:town_pass/service/service_rank_service.dart';
import 'package:town_pass/util/semantic/service_ranker.dart';

import 'fake_embedder.dart';

const _docs = [
  ServiceDoc(id: 'water', texts: ['用水服務：繳水費', '水管破了']),
  ServiceDoc(id: 'vaccine', texts: ['疫苗預約', '打流感疫苗']),
];

void main() {
  late Directory dir;
  late File indexFile;
  setUp(() {
    dir = Directory.systemTemp.createTempSync('rank_service');
    indexFile = File('${dir.path}/index.json');
  });
  tearDown(() => dir.deleteSync(recursive: true));

  ServiceRankService make(FakeEmbedder e, {List<ServiceDoc> docs = _docs}) =>
      ServiceRankService(
        embedderForTest: e,
        docsLoader: () async => docs,
        indexFile: indexFile,
      );

  group('準備流程', () {
    test('一開始是 idle、沒準備好就問不到分數（回 null，不丟例外）', () async {
      final s = make(FakeEmbedder());
      expect(s.status, ServiceRankStatus.idle);
      expect(await s.rank('水'), isNull);
    });

    test('prepare 後 ready，可以問到分數', () async {
      final s = make(FakeEmbedder());
      await s.prepare();
      expect(s.status, ServiceRankStatus.ready);
      expect(s.lastUsedCache, isFalse);
      final scores = await s.rank('水管爆了');
      expect(scores!['water'], greaterThan(scores['vaccine']!));
    });

    test('同時多次 prepare 只做一次', () async {
      final e = FakeEmbedder();
      final s = make(e);
      await Future.wait([s.prepare(), s.prepare(), s.prepare()]);
      expect(e.docCalls, 4); // 2 個服務 × 2 句，不是 12
    });
  });

  group('快取', () {
    test('第二次啟動讀快取，不再重新計算向量', () async {
      final first = FakeEmbedder();
      await make(first).prepare();
      expect(first.docCalls, 4);

      final second = FakeEmbedder();
      final s = make(second);
      await s.prepare();
      expect(s.status, ServiceRankStatus.ready);
      expect(s.lastUsedCache, isTrue);
      expect(second.docCalls, 0);
      final scores = (await s.rank('疫苗'))!;
      expect(scores['vaccine'], greaterThan(scores['water']!)); // 讀回來的向量能正常比對
    });

    test('服務清單或例句變了 → 重算', () async {
      await make(FakeEmbedder()).prepare();
      final e = FakeEmbedder();
      final s = make(
        e,
        docs: [
          ..._docs,
          const ServiceDoc(id: 'book', texts: ['借書']),
        ],
      );
      await s.prepare();
      expect(s.lastUsedCache, isFalse);
      expect(e.docCalls, 5);
    });

    test('模型換了（modelId 不同）→ 重算', () async {
      await make(FakeEmbedder(id: 'model-a')).prepare();
      final e = FakeEmbedder(id: 'model-b');
      final s = make(e);
      await s.prepare();
      expect(s.lastUsedCache, isFalse);
      expect(e.docCalls, 4);
    });

    test('快取檔壞掉 → 重算，不影響使用', () async {
      await make(FakeEmbedder()).prepare();
      indexFile.writeAsStringSync('not json');
      final s = make(FakeEmbedder());
      await s.prepare();
      expect(s.status, ServiceRankStatus.ready);
      expect(s.lastUsedCache, isFalse);
    });
  });

  group('失敗降級', () {
    test('模型出錯 → failed，之後問分數一律 null（網頁退回規則搜尋）', () async {
      final s = make(FakeEmbedder(failOn: '疫苗'));
      await s.prepare();
      expect(s.status, ServiceRankStatus.failed);
      expect(s.lastFailure, isNotNull);
      expect(await s.rank('水'), isNull);
    });

    test('失敗後再 prepare 可以重試成功', () async {
      final e = FakeEmbedder(failOn: '疫苗');
      final s = make(e);
      await s.prepare();
      expect(s.status, ServiceRankStatus.failed);
      e.failOn = null;
      await s.prepare();
      expect(s.status, ServiceRankStatus.ready);
      expect(s.lastFailure, isNull);
    });

    test('準備成功後，問某句時模型出錯 → 丟例外給 handler 處理（handler 會轉成 error 回覆）', () async {
      final e = FakeEmbedder();
      final s = make(e);
      await s.prepare();
      e.failOn = '爆';
      expect(() => s.rank('水管爆了'), throwsStateError);
    });
  });

  group('buildServiceDocs', () {
    test('App 的 21 個服務全都有，第一句是「名稱：說明」', () {
      final docs = buildServiceDocs(phrases: {});
      expect(docs.map((d) => d.id), MyServiceItemId.values.map((e) => e.name));
      for (final d in docs) {
        final item = MyServiceItemId.values.byName(d.id).item;
        expect(d.texts.first, '${item.title}：${item.description}');
      }
    });

    test('例句加在名稱說明後面；空白句與不認識的 id 會被忽略', () {
      final docs = buildServiceDocs(
        phrases: {
          'library': {
            'phrases': ['我想借書', '  ', 5, '還書'],
          },
          'noSuchService': {
            'phrases': ['不應出現'],
          },
        },
      );
      expect(docs.firstWhere((d) => d.id == 'library').texts.skip(1), [
        '我想借書',
        '還書',
      ]);
      expect(docs.any((d) => d.id == 'noSuchService'), isFalse);
    });
  });
}
