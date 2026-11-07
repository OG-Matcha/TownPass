import 'dart:collection';
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:get/get.dart';
import 'package:town_pass/service/shared_preferences_service.dart';

/// 操作輔助層：把 `assets/a11y/tp-a11y.js` 注入每一個微服務網頁（`TPWebView`），微服務不用改程式。
///
/// - 設定（字級、高對比、慣用手、是否啟用）存在 App 的 SharedPreferences，所有微服務共用。
///   網頁端的 localStorage 每個網域各一份，所以跨服務的設定一定要放在 App。
/// - 注入時把目前設定放在 `window.__TP_A11Y_SETTINGS__`，網頁一載入就套用，不會先閃一下原尺寸。
/// - 關掉「操作輔助」時完全不注入（`userScripts()` 回傳空清單），頁面不受任何影響。
/// - 網頁改設定走 `a11y_settings` handler（見 `a11y_settings_message_handler.dart`）。
class A11yLayer {
  A11yLayer._();

  static const String _assetPath = 'assets/a11y/tp-a11y.js';
  static const String _prefsKey = 'a11y_settings';
  static const List<String> fontLevels = ['normal', 'large', 'xlarge'];
  static const Map<String, Object> defaults = {
    'enabled': true,
    'fontLevel': 'normal',
    'highContrast': false,
    'hand': 'right',
  };

  static String _script = '';

  /// App 啟動時呼叫一次（在 SharedPreferencesService 之後）。讀檔失敗就不注入，不影響 App。
  static Future<void> init() async {
    try {
      _script = await rootBundle.loadString(_assetPath);
    } catch (_) {
      _script = '';
    }
  }

  static SharedPreferencesService? get _prefs =>
      Get.isRegistered<SharedPreferencesService>() ? Get.find<SharedPreferencesService>() : null;

  /// 只留下認得的欄位與值（網頁傳來的資料不可信）。
  static Map<String, Object> sanitize(Object? raw) {
    final src = raw is Map ? raw : const {};
    final enabled = src['enabled'];
    final fontLevel = src['fontLevel'];
    final highContrast = src['highContrast'];
    final hand = src['hand'];
    return {
      'enabled': enabled is bool ? enabled : defaults['enabled']!,
      'fontLevel': fontLevel is String && fontLevels.contains(fontLevel) ? fontLevel : defaults['fontLevel']!,
      'highContrast': highContrast is bool ? highContrast : defaults['highContrast']!,
      'hand': hand == 'left' || hand == 'right' ? hand as String : defaults['hand']!,
    };
  }

  static Map<String, Object> get settings {
    final saved = _prefs?.instance.getString(_prefsKey);
    if (saved == null) return Map.of(defaults);
    try {
      return sanitize(jsonDecode(saved));
    } catch (_) {
      return Map.of(defaults);
    }
  }

  static Future<Map<String, Object>> save(Object? raw) async {
    final next = sanitize(raw);
    await _prefs?.instance.setString(_prefsKey, jsonEncode(next));
    return next;
  }

  static bool get enabled => settings['enabled'] == true;

  static Future<void> setEnabled(bool value) async {
    await save({...settings, 'enabled': value});
  }

  /// 給 `TPInAppWebView.initialUserScripts`。每次開微服務時呼叫，拿到當下的設定。
  static UnmodifiableListView<UserScript> userScripts() {
    final current = settings;
    if (_script.isEmpty || current['enabled'] != true) {
      return UnmodifiableListView(const <UserScript>[]);
    }
    return UnmodifiableListView([
      UserScript(
        groupName: 'tp_a11y',
        source: 'window.__TP_A11Y_SETTINGS__ = ${jsonEncode(current)};\n$_script',
        injectionTime: UserScriptInjectionTime.AT_DOCUMENT_END,
        forMainFrameOnly: true,
      ),
    ]);
  }
}
