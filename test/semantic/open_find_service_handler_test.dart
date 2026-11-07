// 單元測試：網頁請 App 打開 Flutter 版「找服務」的 handler。
import 'dart:convert';

import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/util/tp_route.dart';
import 'package:town_pass/util/web_message_handler/open_find_service_message_handler.dart';

Future<Object?> ask(OpenFindServiceMessageHandler h, {bool main = true}) async {
  WebMessage? reply;
  await h.handle(message: null, sourceOrigin: null, isMainFrame: main, onReply: (r) => reply = r);
  final decoded = jsonDecode(reply!.data as String) as Map<String, dynamic>;
  expect(decoded['name'], 'open_find_service');
  return decoded['data'];
}

void main() {
  test('最上層頁面 → 開啟並回 true', () async {
    var opened = 0;
    final h = OpenFindServiceMessageHandler(open: () => opened++, currentRoute: () => '/web_view');
    expect(await ask(h), true);
    expect(opened, 1);
  });
  test('已經在找服務頁 → 不重複開，仍回 true', () async {
    var opened = 0;
    final h = OpenFindServiceMessageHandler(open: () => opened++, currentRoute: () => TPRoute.findService);
    expect(await ask(h), true);
    expect(opened, 0);
  });
  test('內嵌 iframe 送來的 → 拒絕、不換頁', () async {
    var opened = 0;
    final h = OpenFindServiceMessageHandler(open: () => opened++, currentRoute: () => '/');
    expect(await ask(h, main: false), false);
    expect(opened, 0);
  });
  test('name 是 open_find_service', () => expect(OpenFindServiceMessageHandler().name, 'open_find_service'));
}
