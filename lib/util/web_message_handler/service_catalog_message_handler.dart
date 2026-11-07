import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:town_pass/page/city_service/model/my_service_model.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';

/// 給操作輔助層的「找服務」用：把 App 的服務清單（`my_service_model.dart`）交給網頁。
///
/// 網頁 → App：`{ name: 'service_catalog' }`
/// App → 網頁：`{ name: 'service_catalog', data: [ { id, title, description, category, url } | { ..., tel } ] }`
///
/// 只列「打得開」的服務：有 `destinationUrl` 的，加上 1999 專線（撥電話）。
/// 新增服務時照 `my_service_model.dart` 的註解加進列舉與擴充即可，網頁不用改。
/// 內容都是 App 本來就公開顯示的服務名稱與網址，不含個資。
class ServiceCatalogMessageHandler extends TPWebMessageHandler {
  @override
  String get name => 'service_catalog';

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage replyWebMessage)? onReply,
  }) async {
    final services = <Map<String, String>>[];
    for (final id in MyServiceItemId.values) {
      final item = id.item;
      final base = {
        'id': id.name,
        'title': item.title,
        'description': item.description,
        'category': item.category.title,
      };
      if (id == MyServiceItemId.dedicatedLine) {
        services.add({...base, 'tel': '1999'});
      } else if (item.destinationUrl.isNotEmpty) {
        services.add({...base, 'url': item.destinationUrl});
      }
    }
    onReply?.call(replyWebMessage(data: services));
  }
}
