// 單元測試：共用向量服務 embed handler 的輸入檢查、回覆格式與降級。向量模型用假的，不載入模型。
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/util/web_message_handler/embed_message_handler.dart';

import 'fake_embedder.dart';

Future<Map<String, dynamic>?> ask(
  EmbedMessageHandler handler,
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
  expect(decoded['name'], 'embed');
  return decoded['data'] as Map<String, dynamic>;
}

void main() {
  test('回傳與 texts 一一對應、已正規化的向量；kind 決定 query／document', () async {
    final fake = FakeEmbedder();
    final h = EmbedMessageHandler(embedder: fake);
    final data = await ask(h, {
      'texts': ['我到了', '下一步'],
      'kind': 'document',
      'rid': 'e1',
    });
    expect(data!['ok'], true);
    expect(data['rid'], 'e1');
    expect(data['model'], 'fake@1');
    final vectors = (data['vectors'] as List).cast<List>();
    expect(vectors, hasLength(2));
    expect(data['dim'], vectors.first.length);
    for (final v in vectors) {
      final norm = math.sqrt(v.fold<double>(0, (a, x) => a + (x as num) * x));
      expect(norm, closeTo(1, 1e-3));
    }
    expect(fake.docCalls, 2);
    expect(fake.queryCalls, 0);

    await ask(h, {
      'texts': ['我到了'],
      'rid': 2,
    });
    expect(fake.queryCalls, 1, reason: '沒給 kind 視為 query');
  });

  test('格式不對 → bad_request', () async {
    final h = EmbedMessageHandler(embedder: FakeEmbedder());
    for (final m in <Object?>[
      null,
      'x',
      {'texts': []},
      {'texts': 'x'},
      {
        'texts': [1],
      },
      {
        'texts': ['  '],
      },
      {
        'texts': ['a'],
        'kind': 'other',
      },
      {'texts': List.filled(EmbedMessageHandler.maxTexts + 1, 'a')},
      {
        'texts': ['a' * 201],
      },
    ]) {
      final data = await ask(h, m);
      expect(data!['ok'], false, reason: '$m');
      expect(data['reason'], 'bad_request', reason: '$m');
    }
    final sub = await ask(h, {
      'texts': ['a'],
    }, isMainFrame: false);
    expect(sub!['reason'], 'bad_request');
  });

  test('模型出錯 → error（不帶使用者文字）', () async {
    final h = EmbedMessageHandler(embedder: FakeEmbedder(failOn: '壞'));
    final data = await ask(h, {
      'texts': ['好', '壞掉'],
      'rid': 3,
    });
    expect(data, {'ok': false, 'rid': 3, 'reason': 'error'});
  });

  test('沒有向量模型 → not_ready', () async {
    final data = await ask(EmbedMessageHandler(), {
      'texts': ['我到了'],
    });
    expect(data!['reason'], 'not_ready');
  });
}
