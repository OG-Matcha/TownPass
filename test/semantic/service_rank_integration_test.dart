// 整合測試：service_catalog → 向量服務 → service_rank 的資料契約。
// 向量模型用假的（字面重疊越多越像），驗證的是「資料流過多個模組後欄位仍一致、降級路徑真的傳到網頁」，
// 不是模型品質（模型品質看 tool/semantic_search 的量測）。契約範例：tool/semantic_search/contract.json
import 'dart:convert';
import 'dart:io';

import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/page/city_service/model/my_service_model.dart';
import 'package:town_pass/service/service_rank_service.dart';
import 'package:town_pass/util/web_message_handler/service_catalog_message_handler.dart';
import 'package:town_pass/util/web_message_handler/service_rank_message_handler.dart';

import 'fake_embedder.dart';

final _contract = jsonDecode(
  File('tool/semantic_search/contract.json').readAsStringSync(),
) as Map<String, dynamic>;

Future<dynamic> _reply(
  Future<void> Function(Function(WebMessage) onReply) run,
  String name,
) async {
  WebMessage? reply;
  await run((r) => reply = r);
  expect(reply, isNotNull);
  final decoded = jsonDecode(reply!.data as String) as Map<String, dynamic>;
  expect(decoded['name'], name);
  return decoded['data'];
}

Future<List<Map<String, dynamic>>> _catalog() async {
  final data = await _reply(
    (onReply) => ServiceCatalogMessageHandler().handle(
      message: null,
      sourceOrigin: null,
      isMainFrame: true,
      onReply: onReply,
    ),
    'service_catalog',
  );
  return (data as List).cast<Map<String, dynamic>>();
}

Future<Map<String, dynamic>> _rank(
  ServiceRankMessageHandler h,
  Object? message,
) async {
  final data = await _reply(
    (onReply) => h.handle(
      message: message,
      sourceOrigin: null,
      isMainFrame: true,
      onReply: onReply,
    ),
    'service_rank',
  );
  return (data as Map).cast<String, dynamic>();
}

void main() {
  late Directory dir;
  late ServiceRankService service;
  late ServiceRankMessageHandler handler;
  late FakeEmbedder embedder;

  setUp(() async {
    dir = Directory.systemTemp.createTempSync('rank_integration');
    embedder = FakeEmbedder();
    final phrases =
        (jsonDecode(
              File('tool/semantic_search/phrases.json').readAsStringSync(),
            ) as Map)['services']
            as Map<String, dynamic>;
    service = ServiceRankService(
      embedderForTest: embedder,
      docsLoader: () async => buildServiceDocs(phrases: phrases),
      indexFile: File('${dir.path}/index.json'),
    );
    handler = ServiceRankMessageHandler(ranker: service);
  });
  tearDown(() => dir.deleteSync(recursive: true));

  group('service_catalog 契約', () {
    test('列出 21 個服務；每一個都有 url、tel 或 unavailable 其中之一，且只有一個', () async {
      final catalog = await _catalog();
      expect(
        catalog.map((e) => e['id']),
        MyServiceItemId.values.map((e) => e.name),
      );
      for (final e in catalog) {
        final kinds = [
          'url',
          'tel',
          'unavailable',
        ].where(e.containsKey).toList();
        expect(kinds, hasLength(1), reason: '${e['id']} 的入口標記：$kinds');
        expect(e['title'], isA<String>());
        expect(e['description'], isA<String>());
      }
    });

    test('欄位與契約範例一致（url／tel／unavailable 三種）', () async {
      final catalog = {for (final e in await _catalog()) e['id'] as String: e};
      final c = _contract['service_catalog'] as Map<String, dynamic>;
      Set<String> keys(String name) =>
          (c[name] as Map).keys.cast<String>().toSet();
      expect(catalog['library']!.keys.toSet(), keys('replyEntryWithUrl'));
      expect(catalog['dedicatedLine']!.keys.toSet(), keys('replyEntryWithTel'));
      expect(
        catalog['vaccineAppointment']!.keys.toSet(),
        keys('replyEntryUnavailable'),
      );
      expect(catalog['dedicatedLine']!['tel'], '1999');
      expect(catalog['vaccineAppointment']!['unavailable'], isTrue);
    });

    test('沒入口的服務就是 App 裡 destinationUrl 為空的那些（1999 除外）', () async {
      final unavailable = (await _catalog())
          .where((e) => e['unavailable'] == true)
          .map((e) => e['id'])
          .toSet();
      final expected = MyServiceItemId.values
          .where(
            (id) =>
                id != MyServiceItemId.dedicatedLine &&
                id.item.destinationUrl.isEmpty,
          )
          .map((id) => id.name)
          .toSet();
      expect(unavailable, expected);
    });
  });

  group('catalog → 向量服務 → service_rank', () {
    test('用 catalog 的 id 問分數：每個 id 都有分數，欄位與契約範例一致', () async {
      await service.prepare();
      final catalog = await _catalog();
      final ids = catalog.map((e) => e['id'] as String).toList();
      // 用服務自己的「名稱：說明」原句去問，它的相似度必須是 1、而且排第一（驗證接線，不是模型品質）
      final target = catalog.firstWhere((e) => e['id'] == 'vaccineAppointment');
      final data = await _rank(handler, {
        'query': '${target['title']}：${target['description']}',
        'ids': ids,
        'rid': 1,
      });
      final contract =
          (_contract['service_rank'] as Map<String, dynamic>)['replyOk']['data']
              as Map<String, dynamic>;

      expect(data.keys.toSet(), contract.keys.toSet());
      expect(data['ok'], isTrue);
      expect(data['rid'], 1);
      final scores = (data['scores'] as Map).cast<String, num>();
      expect(scores.keys.toSet(), ids.toSet());
      expect(scores.values.every((s) => s >= -1 && s <= 1), isTrue);
      final top = scores.entries.reduce((a, b) => a.value >= b.value ? a : b);
      expect(top.key, 'vaccineAppointment');
      expect(top.value, closeTo(1, 1e-3));
    });

    test('每個服務都真的有例句進索引（21 個服務都比得到）', () async {
      await service.prepare();
      final data = await _rank(handler, {'query': '預約流感疫苗'});
      expect(
        (data['scores'] as Map).keys.toSet(),
        MyServiceItemId.values.map((e) => e.name).toSet(),
      );
    });

    test('只問部分服務時，只回那些', () async {
      await service.prepare();
      final data = await _rank(handler, {
        'query': '借書',
        'ids': ['library', 'zoo'],
      });
      expect((data['scores'] as Map).keys.toSet(), {'library', 'zoo'});
    });
  });

  group('降級路徑真的傳到網頁（欄位與契約範例一致）', () {
    Set<String> failKeys() =>
        ((_contract['service_rank'] as Map)['replyFail']['data'] as Map).keys
            .cast<String>()
            .toSet();
    Set<String> reasons() =>
        ((_contract['service_rank'] as Map)['failReasons'] as List)
            .cast<String>()
            .toSet();

    test('模型還沒準備好 → not_ready', () async {
      final data = await _rank(handler, {'query': '水', 'rid': 5});
      expect(data.keys.toSet(), failKeys());
      expect(data, containsPair('ok', false));
      expect(data['rid'], 5);
      expect(reasons(), contains(data['reason']));
      expect(data['reason'], 'not_ready');
    });

    test('模型載入失敗 → not_ready，而且 catalog 仍然正常（找服務不受影響）', () async {
      final broken = ServiceRankService(
        embedderForTest: FakeEmbedder(failOn: '疫苗'),
        docsLoader: () async => buildServiceDocs(phrases: {}),
        indexFile: File('${dir.path}/broken.json'),
      );
      await broken.prepare();
      expect(broken.status, ServiceRankStatus.failed);
      final data = await _rank(ServiceRankMessageHandler(ranker: broken), {
        'query': '水',
      });
      expect(data['reason'], 'not_ready');
      expect(await _catalog(), hasLength(21));
    });

    test('比對時出錯 → error', () async {
      await service.prepare();
      embedder.failOn = '爆';
      final data = await _rank(handler, {'query': '水管爆了', 'rid': 2});
      expect(data, {'ok': false, 'rid': 2, 'reason': 'error'});
      expect(reasons(), contains('error'));
    });

    test('格式不對 → bad_request；所有 reason 都在契約列出的範圍內', () async {
      final data = await _rank(handler, {'query': ''});
      expect(data['reason'], 'bad_request');
      expect(reasons(), containsAll(['bad_request', 'not_ready', 'error']));
    });
  });

  test('快取鍵：換模型身分後，第二次啟動不會誤用舊向量', () async {
    final phrases =
        (jsonDecode(
              File('tool/semantic_search/phrases.json').readAsStringSync(),
            ) as Map)['services']
            as Map<String, dynamic>;
    final file = File('${dir.path}/shared.json');
    ServiceRankService make(String id) => ServiceRankService(
      embedderForTest: FakeEmbedder(id: id),
      docsLoader: () async => buildServiceDocs(phrases: phrases),
      indexFile: file,
    );
    final a = make('model-a');
    await a.prepare();
    final again = make('model-a');
    await again.prepare();
    expect(again.lastUsedCache, isTrue);
    final b = make('model-b');
    await b.prepare();
    expect(b.lastUsedCache, isFalse);
  });
}
