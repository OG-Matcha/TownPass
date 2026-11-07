import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:get/get.dart';
import 'package:town_pass/util/tp_route.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';

/// 微服務網頁的輔助選單按「找服務」時，請 App 打開 Flutter 版的找服務畫面（與首頁共用同一份）。
///
/// 網頁 → App：`{ name: 'open_find_service' }`
/// App → 網頁：`{ name: 'open_find_service', data: true }`（已開啟或本來就在這一頁）或 `data: false`（拒絕，例如內嵌的 iframe）
///
/// 只接受最上層頁面（`isMainFrame`）的請求；內嵌的廣告或地圖不能叫 App 換頁。
class OpenFindServiceMessageHandler extends TPWebMessageHandler {
  OpenFindServiceMessageHandler({
    void Function()? open,
    String Function()? currentRoute,
  }) : _open = open ?? (() => Get.toNamed(TPRoute.findService)),
       _currentRoute = currentRoute ?? (() => Get.currentRoute);

  final void Function() _open;
  final String Function() _currentRoute;

  @override
  String get name => 'open_find_service';

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage replyWebMessage)? onReply,
  }) async {
    if (!isMainFrame) {
      onReply?.call(replyWebMessage(data: false));
      return;
    }
    if (_currentRoute() != TPRoute.findService) _open();
    onReply?.call(replyWebMessage(data: true));
  }
}
