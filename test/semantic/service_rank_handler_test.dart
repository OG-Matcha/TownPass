// 單元測試：service_rank handler 的輸入檢查、回覆格式與降級。排名器用假的，不載入模型。
import 'dart:convert';

import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/service/service_rank_service.dart';
import 'package:town_pass/util/semantic/service_ranker.dart';
import 'package:town_pass/util/web_message_handler/service_rank_message_handler.dart';

import 'stub_ranker.dart';

/// 呼叫 handler 並取出回覆的 data（Map）；沒有回覆就回 null。
Future<Map<String, dynamic>?> ask(
  ServiceRankMessageHandler handler,
  Object? message, {
  bool isMainFrame = true,
}) async {
  WebMessage? reply;
  await handler.handle(
    message: message,
    sourceOrigin: null,
    isMainFrame: isMainFrame,
    onReply: (r) => reply = r,
  );
  if (reply == null) return null;
  final decoded = jsonDecode(reply!.data as String) as Map<String, dynamic>;
  expect(decoded['name'], 'service_rank');
  return decoded['data'] as Map<String, dynamic>;
}

void main() {
  test('name 是 service_rank', () {
    expect(
      ServiceRankMessageHandler(ranker: StubRanker()).name,
      'service_rank',
    );
  });

  group('成功', () {
    test('回傳 ok、rid、分數、模型身分', () async {
      final ranker = StubRanker(result: {'water': 0.9, 'lamp': 0.2});
      final data = await ask(ServiceRankMessageHandler(ranker: ranker), {
        'query': '水管爆了',
        'rid': 7,
      });
      expect(data, {
        'ok': true,
        'rid': 7,
        'scores': {'water': 0.9, 'lamp': 0.2},
        'model': ServiceRankModel.id,
      });
      expect(ranker.calls.single.query, '水管爆了');
      expect(ranker.calls.single.ids, isNull);
    });

    test('ids 會傳給排名器；rid 可以是字串', () async {
      final ranker = StubRanker(result: {'water': 0.9});
      final data = await ask(ServiceRankMessageHandler(ranker: ranker), {
        'query': '水',
        'ids': ['water', 'lamp'],
        'rid': 'abc',
      });
      expect(data!['rid'], 'abc');
      expect(ranker.calls.single.ids, {'water', 'lamp'});
    });

    test('rid 不是數字或字串 → 回 null，不會把怪東西原樣送回網頁', () async {
      final data = await ask(
        ServiceRankMessageHandler(ranker: StubRanker(result: {})),
        {
          'query': '水',
          'rid': {'x': 1},
        },
      );
      expect(data!['rid'], isNull);
    });
  });

  group('格式不對 → bad_request（不呼叫排名器）', () {
    final bad = <String, Object?>{
      '沒有訊息': null,
      '不是物件': '水管爆了',
      '沒有 query': {'rid': 1},
      'query 不是字串': {'query': 123},
      'query 是空白': {'query': '   '},
      'query 太長': {'query': '水' * (maxQueryChars + 1)},
      'ids 不是清單': {'query': '水', 'ids': 'water'},
      'ids 含非字串': {
        'query': '水',
        'ids': ['water', 5],
      },
      'ids 太多': {
        'query': '水',
        'ids': List.generate(
          ServiceRankMessageHandler.maxIds + 1,
          (i) => 'id$i',
        ),
      },
    };
    bad.forEach((name, message) {
      test(name, () async {
        final ranker = StubRanker(result: {'water': 1});
        final data = await ask(
          ServiceRankMessageHandler(ranker: ranker),
          message,
        );
        expect(data, containsPair('ok', false));
        expect(data!['reason'], 'bad_request');
        expect(ranker.calls, isEmpty);
      });
    });

    test('不是最上層頁面（內嵌的 iframe）→ bad_request', () async {
      final ranker = StubRanker(result: {'water': 1});
      final data = await ask(ServiceRankMessageHandler(ranker: ranker), {
        'query': '水',
      }, isMainFrame: false);
      expect(data!['reason'], 'bad_request');
      expect(ranker.calls, isEmpty);
    });

    test('query 剛好 200 字可以通過', () async {
      final data = await ask(
        ServiceRankMessageHandler(ranker: StubRanker(result: {})),
        {'query': '水' * maxQueryChars},
      );
      expect(data!['ok'], isTrue);
    });
  });

  group('降級（網頁收到 ok:false 要無聲退回規則搜尋）', () {
    for (final status in [
      ServiceRankStatus.idle,
      ServiceRankStatus.preparing,
      ServiceRankStatus.failed,
    ]) {
      test('模型狀態 ${status.name} → not_ready，不呼叫排名器', () async {
        final ranker = StubRanker(status: status, result: {'water': 1});
        final data = await ask(ServiceRankMessageHandler(ranker: ranker), {
          'query': '水',
          'rid': 3,
        });
        expect(data, {'ok': false, 'rid': 3, 'reason': 'not_ready'});
        expect(ranker.calls, isEmpty);
      });
    }

    test('排名器回 null → not_ready', () async {
      final data = await ask(ServiceRankMessageHandler(ranker: StubRanker()), {
        'query': '水',
      });
      expect(data!['reason'], 'not_ready');
    });

    test('排名器丟例外 → error，而且回覆裡沒有使用者輸入的內容', () async {
      final ranker = StubRanker(error: StateError('裡面帶著 我的身分證字號 A123456789'));
      final data = await ask(ServiceRankMessageHandler(ranker: ranker), {
        'query': '我的身分證字號 A123456789',
        'rid': 9,
      });
      expect(data, {'ok': false, 'rid': 9, 'reason': 'error'});
      expect(jsonEncode(data), isNot(contains('A123456789')));
    });

    test('沒有註冊 ServiceRankService（例如測試環境）→ not_ready，不丟例外', () async {
      final data = await ask(ServiceRankMessageHandler(), {'query': '水'});
      expect(data!['reason'], 'not_ready');
    });
  });
}
