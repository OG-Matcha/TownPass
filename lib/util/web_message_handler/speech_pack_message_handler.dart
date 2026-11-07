import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:town_pass/util/speech/speech_pack.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';

/// 網頁 → App：`{ name: 'speech_pack', data: { action: 'download', locale: 'zh-TW' } }`
/// App → 網頁：`{ name: 'speech_pack', data: { ok: true } }` 或 `{ data: { error: '...' } }`
///
/// 觸發系統下載離線語音包（要網路，只需一次）；辨識本身仍只在裝置端。
class SpeechPackMessageHandler extends TPWebMessageHandler {
  @override
  String get name => 'speech_pack';

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage replyWebMessage)? onReply,
  }) async {
    final map = message is Map ? message : const {};
    if ((map['action'] ?? 'download') != 'download') {
      onReply?.call(replyWebMessage(data: {'error': '不支援的操作'}));
      return;
    }
    final r = await SpeechPack.download(locale: (map['locale'] as String?) ?? 'zh-TW');
    onReply?.call(replyWebMessage(data: r['ok'] != null ? {'ok': true} : {'error': r['error']}));
  }
}
