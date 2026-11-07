import 'package:flutter/services.dart';

/// 觸發系統下載離線語音包（只需一次，要網路）。只下載，不做任何雲端辨識。
/// 回傳 `{'ok': 'true'}` 或 `{'error': '給使用者看的說明'}`。
class SpeechPack {
  static const MethodChannel _channel = MethodChannel('town_pass/speech_pack');

  static Future<Map<String, String>> download({String locale = 'zh-TW'}) async {
    try {
      final r = await _channel.invokeMethod<String>('download', {'locale': locale});
      return switch (r) {
        'ok' => {'ok': 'true'},
        'installed' => {'error': '離線語音已安裝；若仍無法使用，請改用打字'},
        'unsupported' => {'error': '請到手機「設定」的語音辨識，下載中文離線語音'},
        'unavailable' => {'error': '這台手機不支援離線語音，請用打字的'},
        _ => {'error': '無法開始下載，請到手機設定下載中文離線語音'},
      };
    } catch (_) {
      return {'error': '無法開始下載，請到手機設定下載中文離線語音'};
    }
  }
}
