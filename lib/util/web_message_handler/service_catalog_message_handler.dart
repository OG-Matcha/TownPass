import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:town_pass/page/city_service/model/my_service_model.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';

/// 給操作輔助層的「找服務」用：把 App 的服務清單（`my_service_model.dart`）交給網頁。
///
/// 網頁 → App：`{ name: 'service_catalog' }`
/// App → 網頁：`{ name: 'service_catalog', data: [ { id, title, description, category, url } | { ..., tel } | { ..., unavailable: true } ] }`
///
/// 列出全部服務。有 `destinationUrl` 的給 `url`，1999 專線給 `tel`（撥電話）；
/// 兩者都沒有的（App 裡點了沒反應的服務）標 `unavailable: true`：仍可被搜尋找到，
/// 但網頁要顯示「尚未開通」並改建議撥 1999，不能假裝點得開。
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
    final services = <Map<String, Object>>[];
    for (final id in MyServiceItemId.values) {
      final item = id.item;
      final base = <String, Object>{
        'id': id.name,
        'title': item.title,
        'description': item.description,
        'category': item.category.title,
      };
      if (id == MyServiceItemId.dedicatedLine) {
        services.add({...base, 'tel': '1999'});
      } else if (item.destinationUrl.isNotEmpty) {
        services.add({...base, 'url': item.destinationUrl});
      } else {
        services.add({...base, 'unavailable': true});
      }
    }
    onReply?.call(replyWebMessage(data: services));
  }
}
