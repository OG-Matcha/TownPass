// Widget 測試：Flutter 版「找服務」畫面與首頁浮動鈕。排名器與撥號、開網頁都用假的。
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:town_pass/page/find_service/find_service_button.dart';
import 'package:town_pass/page/find_service/find_service_view.dart';
import 'package:town_pass/page/find_service/find_service_view_controller.dart';
import 'package:town_pass/util/tp_route.dart';

import 'stub_ranker.dart';

late List<String> calls;
late List<String> opened;

Future<FindServiceViewController> pumpView(WidgetTester tester, {StubRanker? ranker}) async {
  calls = [];
  opened = [];
  final c = FindServiceViewController(
    ranker: ranker,
    voice: FakeVoice({'text': '借書'}),
    onCall: (tel) async => calls.add(tel),
    onOpenUrl: (url) async => opened.add(url),
    debounce: const Duration(milliseconds: 10),
  );
  Get.put<FindServiceViewController>(c);
  await tester.pumpWidget(const GetMaterialApp(home: FindServiceView()));
  await tester.pump();
  return c;
}

Future<void> typeQuery(WidgetTester tester, String q) async {
  await tester.enterText(find.byKey(const Key('findServiceField')), q);
  await tester.pump(const Duration(milliseconds: 50));
  await tester.pump();
}

void main() {
  setUp(Get.reset);

  testWidgets('一開始顯示常見問題與 1999 按鈕，沒有結果', (tester) async {
    await pumpView(tester);
    expect(find.text('常見問題'), findsOneWidget);
    expect(find.text('路燈壞了'), findsOneWidget);
    expect(find.byKey(const Key('call1999')), findsOneWidget);
  });

  testWidgets('輸入「路燈壞了」→ 出現「有話要說」，點了前往網址', (tester) async {
    await pumpView(tester);
    await typeQuery(tester, '路燈壞了');
    expect(find.text('有話要說'), findsWidgets);
    expect(find.textContaining('因為提到'), findsWidgets);
    await tester.tap(find.text('有話要說').first);
    expect(opened.single, contains('citizen-report'));
  });

  testWidgets('語意找到、沒入口的服務 → 說明「還沒開通」，按鈕是「撥 1999」，點了撥號', (tester) async {
    final catalog = buildSearchCatalog();
    final scores = {for (var i = 0; i < catalog.length; i++) catalog[i].id: 0.8 + (i % 3) * 0.004, 'petFriendlyMap': 0.95};
    await pumpView(tester, ranker: StubRanker(result: scores));
    await typeQuery(tester, '我家毛小孩想出去透透氣');
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('寵物安心遛'), findsOneWidget);
    expect(find.textContaining('還沒開通'), findsOneWidget);
    // 「為什麼找到它」要和「還沒開通」並列，不能被蓋掉。
    expect(find.text('意思和你說的很接近'), findsOneWidget);
    expect(find.text('撥 1999'), findsOneWidget);
    await tester.tap(find.text('寵物安心遛'));
    expect(calls, ['1999']);
    expect(opened, isEmpty);
  });

  testWidgets('模型失敗時畫面照樣有規則結果，沒有錯誤字眼', (tester) async {
    await pumpView(tester, ranker: StubRanker(error: StateError('boom')));
    await typeQuery(tester, '路燈壞了');
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('有話要說'), findsWidgets);
    expect(find.textContaining('錯誤'), findsNothing);
    expect(find.textContaining('失敗'), findsNothing);
  });

  testWidgets('找不到 → 說明提到 1999；按「直接撥 1999」撥號', (tester) async {
    await pumpView(tester);
    await typeQuery(tester, '幫我訂高鐵票');
    expect(tester.widget<Text>(find.byKey(const Key('status'))).data, contains('打電話問 1999'));
    await tester.tap(find.byKey(const Key('call1999')));
    expect(calls, ['1999']);
  });

  testWidgets('按「搜尋」鈕用輸入框的字搜尋；按鈕上有文字（不是只有圖示）', (tester) async {
    await pumpView(tester);
    expect(find.text('用講的'), findsOneWidget);
    expect(find.text('搜尋'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('findServiceField')), '借書');
    await tester.tap(find.byKey(const Key('search')));
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('圖書借閱'), findsWidgets);
  });

  testWidgets('點常見問題直接搜尋；清除鈕回到常見問題', (tester) async {
    await pumpView(tester);
    await tester.tap(find.text('借書'));
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('圖書借閱'), findsWidgets);
    expect(find.text('常見問題'), findsNothing);
    await tester.tap(find.byKey(const Key('clearQuery')));
    await tester.pump();
    expect(find.text('常見問題'), findsOneWidget);
    expect(find.byKey(const Key('findServiceField')), findsOneWidget);
  });

  testWidgets('用講的：辨識結果填入並搜尋', (tester) async {
    await pumpView(tester);
    await tester.tap(find.byKey(const Key('speak')));
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pump();
    expect(find.text('圖書借閱'), findsWidgets);
  });

  testWidgets('所有可點的東西至少 64dp 高（與網頁版一致）', (tester) async {
    await pumpView(tester);
    for (final key in ['speak', 'search', 'call1999']) {
      expect(tester.getSize(find.byKey(Key(key))).height, greaterThanOrEqualTo(64), reason: key);
    }
    expect(tester.getSize(find.byKey(const Key('findServiceField'))).height, greaterThanOrEqualTo(64));
    await typeQuery(tester, '路燈壞了');
    final card = find.ancestor(of: find.text('有話要說').first, matching: find.byType(InkWell)).first;
    expect(tester.getSize(card).height, greaterThanOrEqualTo(64));
  });

  group('首頁浮動鈕', () {
    testWidgets('操作輔助關閉時不顯示', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: Scaffold(floatingActionButton: FindServiceButton(enabled: false))));
      expect(find.byKey(const Key('findServiceButton')), findsNothing);
    });

    testWidgets('開啟時顯示，點了前往找服務頁', (tester) async {
      await tester.pumpWidget(GetMaterialApp(
        initialRoute: '/',
        getPages: [
          GetPage(name: '/', page: () => const Scaffold(floatingActionButton: FindServiceButton(enabled: true))),
          GetPage(name: TPRoute.findService, page: () => const Scaffold(body: Text('FIND PAGE'))),
        ],
      ));
      await tester.pumpAndSettle();
      final size = tester.getSize(find.byKey(const Key('findServiceButton')));
      expect(size, const Size(64, 64)); // 與網頁版輔助鈕同尺寸
      await tester.tap(find.byKey(const Key('findServiceButton')));
      await tester.pumpAndSettle();
      expect(find.text('FIND PAGE'), findsOneWidget);
    });
  });
}
