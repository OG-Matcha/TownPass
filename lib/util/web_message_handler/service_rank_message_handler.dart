import 'package:flutter/foundation.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:get/get.dart';
import 'package:town_pass/service/service_rank_service.dart';
import 'package:town_pass/util/semantic/service_ranker.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';

/// 給操作輔助層的「找服務」用：回傳使用者這句話和每個服務有多像（裝置端向量比對）。
///
/// 網頁 → App：`{ name: 'service_rank', data: { query: '家裡淹水了', ids?: ['disasterReport', ...], rid?: 7 } }`
/// App → 網頁：`{ name: 'service_rank', data: { ok: true, rid, scores: { disasterReport: 0.71, ... }, model } }`
///           或 `{ name: 'service_rank', data: { ok: false, rid, reason } }`
///
/// `reason` 只會是 `bad_request`（格式不對）、`not_ready`（模型還沒準備好或載入失敗）、`error`（比對時出錯）。
/// 網頁收到 `ok: false` 要無聲退回規則搜尋，不顯示任何錯誤。
/// `rid` 原樣回傳，讓網頁分得出是哪一次查詢的回覆。
///
/// 隱私：使用者的話只在裝置上轉成向量，不送出、不寫入記錄檔（連錯誤訊息都不含內容）。
/// 只回應最上層頁面（`isMainFrame`）；內嵌的廣告、地圖不能用。
class ServiceRankMessageHandler extends TPWebMessageHandler {
  ServiceRankMessageHandler({this._ranker});

  final ServiceRanker? _ranker;

  @override
  String get name => 'service_rank';

  /// 同時比對的服務 id 上限（App 目前 21 個，留一些空間）。
  static const int maxIds = 64;

  ServiceRanker? get _resolvedRanker =>
      _ranker ??
      (Get.isRegistered<ServiceRankService>()
          ? Get.find<ServiceRankService>()
          : null);

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage replyWebMessage)? onReply,
  }) async {
    final rid =
        message is Map && (message['rid'] is num || message['rid'] is String)
        ? message['rid']
        : null;

    Map<String, Object?> fail(String reason) => {
      'ok': false,
      'rid': rid,
      'reason': reason,
    };

    final Map<String, Object?> data = await _answer(
      message,
      isMainFrame: isMainFrame,
      rid: rid,
      fail: fail,
    );
    onReply?.call(replyWebMessage(data: data));
  }

  Future<Map<String, Object?>> _answer(
    Object? message, {
    required bool isMainFrame,
    required Object? rid,
    required Map<String, Object?> Function(String reason) fail,
  }) async {
    if (!isMainFrame || message is! Map) return fail('bad_request');
    final query = message['query'];
    if (query is! String ||
        query.trim().isEmpty ||
        query.trim().length > maxQueryChars) {
      return fail('bad_request');
    }

    Set<String>? ids;
    final rawIds = message['ids'];
    if (rawIds != null) {
      if (rawIds is! List ||
          rawIds.length > maxIds ||
          rawIds.any((e) => e is! String)) {
        return fail('bad_request');
      }
      ids = rawIds.cast<String>().toSet();
    }

    final ranker = _resolvedRanker;
    if (ranker == null || ranker.status != ServiceRankStatus.ready) {
      return fail('not_ready');
    }

    try {
      final scores = await ranker.rank(query, ids: ids);
      if (scores == null) return fail('not_ready');
      return {
        'ok': true,
        'rid': rid,
        'scores': scores,
        'model': ServiceRankModel.id,
      };
    } catch (e) {
      // 只記錯誤型別；錯誤訊息可能帶到使用者輸入，不記
      debugPrint('service_rank: 比對失敗（${e.runtimeType}）');
      return fail('error');
    }
  }
}
