import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:town_pass/util/a11y/a11y_layer.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';

/// 操作輔助層的設定讀寫（`assets/a11y/tp-a11y.js` 呼叫）。
///
/// 網頁 → App：
///   `{ name: 'a11y_settings', data: { action: 'get' } }`
///   `{ name: 'a11y_settings', data: { action: 'set', settings: { fontLevel, highContrast, hand } } }`
/// App → 網頁：`{ name: 'a11y_settings', data: { enabled, fontLevel, highContrast, hand } }`
///
/// 只存四個顯示偏好，不含個資；網頁不能透過這裡關掉操作輔助（`enabled` 只能在 App 設定頁改），
/// 免得某個頁面把輔助關掉後，使用者找不到地方開回來。
class A11ySettingsMessageHandler extends TPWebMessageHandler {
  @override
  String get name => 'a11y_settings';

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage replyWebMessage)? onReply,
  }) async {
    final data = message is Map ? message : const {};
    final current = A11yLayer.settings;
    if (data['action'] == 'set' && isMainFrame) {
      final incoming = data['settings'] is Map ? Map.of(data['settings'] as Map) : <dynamic, dynamic>{};
      incoming['enabled'] = current['enabled'];
      final saved = await A11yLayer.save({...current, ...incoming});
      onReply?.call(replyWebMessage(data: saved));
      return;
    }
    onReply?.call(replyWebMessage(data: current));
  }
}
