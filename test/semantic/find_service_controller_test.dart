// 單元測試：Flutter 版「找服務」的邏輯。排名器與語音用假的。

import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:town_pass/page/find_service/find_service_view_controller.dart';
import 'package:town_pass/service/service_rank_service.dart';
import 'package:town_pass/util/semantic/service_search.dart';

import 'stub_ranker.dart';

/// 所有服務分數接近，指定的服務突出（模型有把握）。
Map<String, double> prominent(String id) {
  final catalog = buildSearchCatalog();
  return {for (var i = 0; i < catalog.length; i++) catalog[i].id: 0.8 + (i % 3) * 0.004, id: 0.95};
}

void main() {
  setUp(Get.reset);

  late List<String> calls;
  late List<String> opened;
  FindServiceViewController make({StubRanker? ranker, FakeVoice? voice, Duration rankTimeout = const Duration(seconds: 2)}) {
    calls = [];
    opened = [];
    return FindServiceViewController(
      ranker: ranker,
      voice: voice,
      onCall: (tel) async => calls.add(tel),
      onOpenUrl: (url) async => opened.add(url),
      debounce: const Duration(milliseconds: 20),
      rankTimeout: rankTimeout,
    );
  }

  group('搜尋', () {
    test('空字串 → 清空結果與狀態', () async {
      final c = make();
      await c.search('路燈壞了');
      expect(c.hits, isNotEmpty);
      await c.search('   ');
      expect(c.hits, isEmpty);
      expect(c.status.value, '');
    });

    test('沒有排名器（模型沒準備）→ 用規則搜尋，沒有錯誤字眼', () async {
      final c = make();
      await c.search('路燈壞了');
      expect(c.hits.first.service.id, 'reportIssue');
      expect(c.status.value, contains('找到'));
      expect(c.status.value, isNot(contains('錯誤')));
    });

    test('模型還沒好（preparing/failed）→ 不呼叫排名器，用規則結果', () async {
      for (final st in [ServiceRankStatus.idle, ServiceRankStatus.preparing, ServiceRankStatus.failed]) {
        final r = StubRanker(status: st, result: prominent('zoo'));
        final c = make(ranker: r);
        await c.search('路燈壞了');
        expect(r.calls, isEmpty, reason: st.name);
        expect(c.hits.first.service.id, 'reportIssue');
      }
    });

    test('模型好了 → 沒有關鍵字的口語句靠語意找到（寵物安心遛）', () async {
      final r = StubRanker(result: prominent('petFriendlyMap'));
      final c = make(ranker: r);
      await c.search('我家毛小孩想出去透透氣');
      expect(c.hits.first.service.id, 'petFriendlyMap');
      expect(c.hits.first.semantic, isTrue);
      expect(r.calls.single.ids, hasLength(21));
    });

    test('排名器丟例外 → 無聲退回規則結果', () async {
      final c = make(ranker: StubRanker(error: StateError('boom')));
      await c.search('路燈壞了');
      expect(c.hits.first.service.id, 'reportIssue');
      expect(c.status.value, isNot(contains('錯誤')));
    });

    test('排名器逾時 → 退回規則結果', () async {
      final c = make(ranker: StubRanker(result: prominent('zoo'), delay: const Duration(seconds: 5)), rankTimeout: const Duration(milliseconds: 50));
      await c.search('路燈壞了');
      expect(c.hits.first.service.id, 'reportIssue');
    });

    test('排名器回 null → 退回規則結果', () async {
      final c = make(ranker: StubRanker());
      await c.search('路燈壞了');
      expect(c.hits.first.service.id, 'reportIssue');
    });

    test('連續查詢：慢的舊回覆不能蓋掉新結果', () async {
      final slow = StubRanker(result: prominent('library'), delay: const Duration(milliseconds: 200));
      final c = make(ranker: slow);
      final first = c.search('借書');
      await Future<void>.delayed(const Duration(milliseconds: 20));
      slow
        ..result = prominent('zoo')
        ..delay = Duration.zero;
      await c.search('想去看動物');
      await first;
      expect(c.hits.first.service.id, 'zoo');
    });

    test('沒有任何結果 → 說明並提到 1999', () async {
      final c = make();
      await c.search('幫我訂高鐵票');
      expect(c.hits, isEmpty);
      expect(c.status.value, contains('1999'));
    });

    test('onChanged 有防抖：連打只搜最後一次', () async {
      final r = StubRanker(result: prominent('library'));
      final c = make(ranker: r);
      c.onChanged('借');
      c.onChanged('借書');
      await Future<void>.delayed(const Duration(milliseconds: 100));
      expect(r.calls.map((e) => e.query), ['借書']);
      expect(c.hasQuery.value, isTrue);
    });
  });

  group('點結果', () {
    SearchHit hit(FindServiceViewController c, String id) => SearchHit(service: c.catalog.firstWhere((s) => s.id == id), score: 1, reasons: const []);

    test('有網址 → 前往該網址', () async {
      final c = make();
      await c.open(hit(c, 'library'));
      expect(opened, ['https://taipei-pass-service.vercel.app/library-service/']);
      expect(calls, isEmpty);
    });
    test('尚未開通的服務 → 改撥 1999，不會開網頁', () async {
      final c = make();
      await c.open(hit(c, 'vaccineAppointment'));
      expect(calls, ['1999']);
      expect(opened, isEmpty);
    });
    test('1999 本身 → 撥 1999', () async {
      final c = make();
      await c.open(hit(c, 'dedicatedLine'));
      expect(calls, ['1999']);
    });
    test('「找不到？撥 1999」按鈕', () async {
      final c = make();
      await c.call1999();
      expect(calls, ['1999']);
    });
  });

  group('用講的', () {
    test('辨識成功 → 填入輸入框並搜尋', () async {
      final c = make(voice: FakeVoice({'text': '路燈壞了'}));
      await c.speak();
      expect(c.text.text, '路燈壞了');
      expect(c.hits.first.service.id, 'reportIssue');
      expect(c.listening.value, isFalse);
    });
    test('辨識失敗 → 顯示說明（請改打字），不搜尋', () async {
      final c = make(voice: FakeVoice({'error': '手機還沒有下載中文離線語音，請先用打字的'}));
      await c.speak();
      expect(c.status.value, contains('打字'));
      expect(c.hits, isEmpty);
      expect(c.listening.value, isFalse);
    });
    test('聆聽中再按一次 → 取消', () async {
      final v = FakeVoice({'text': '借書'});
      final c = make(voice: v);
      final running = c.speak();
      await Future<void>.delayed(Duration.zero);
      c.listening.value = true; // speak 已進入聆聽
      await c.speak();
      expect(v.cancelled, isTrue);
      await running;
    });
  });
}
