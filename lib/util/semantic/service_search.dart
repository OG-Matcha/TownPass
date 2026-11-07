import 'dart:math' as math;

// 「找服務」的排序邏輯（純 Dart）：規則搜尋＋語意分數合併。
//
// 這是 assets/a11y/tp-a11y.js 裡 searchServices／mergeRanking 的 Dart 版。
// 兩邊必須算出一樣的結果：tool/semantic_search/parity.json 是用 JS 算出的標準答案，
// test/semantic/service_search_test.dart 逐題比對；改了任何一邊，要重跑
// `node tool/semantic_search/make_parity.mjs` 並讓兩邊測試都過。

/// 搜尋用的服務資料。
class SearchService {
  const SearchService({
    required this.id,
    required this.title,
    required this.desc,
    this.url = '',
    this.tel = '',
  });

  final String id;
  final String title;
  final String desc;
  final String url;
  final String tel;

  /// 沒有網址也沒有電話：App 裡點了沒反應的服務。搜得到，但畫面要說「還沒開通」並改撥 1999。
  bool get unavailable => url.isEmpty && tel.isEmpty;
}

class SearchHit {
  const SearchHit({
    required this.service,
    required this.score,
    required this.reasons,
    this.semantic = false,
  });

  final SearchService service;
  final double score;
  final List<String> reasons;
  final bool semantic;
}

/// 語意分數與規則分數的合併參數。意義與取值依據見 tp-a11y.js 的 SEMANTIC。
class SemanticConfig {
  const SemanticConfig({
    this.abstainZ = 2.0,
    this.showZ = 1.5,
    this.fullZ = 3.0,
    this.weight = 0.7,
    this.minScores = 5,
  });

  final double abstainZ;
  final double showZ;
  final double fullZ;
  final double weight;
  final int minScores;
}

const SemanticConfig defaultSemanticConfig = SemanticConfig();

/// 「市民會怎麼說」的關鍵字（團隊整理，不是官方資料）。其他服務靠名稱、說明與語意找到。
const Map<String, List<String>> serviceKeywords = {
  'districtOffice': [
    '申請',
    '申辦',
    '補助',
    '津貼',
    '證明',
    '身障',
    '身心障礙',
    '手冊',
    '低收',
    '謄本',
    '線上辦',
    '表單',
  ],
  'reportIssue': [
    '陳情',
    '檢舉',
    '反映',
    '抱怨',
    '建議',
    '路燈',
    '壞了',
    '坑洞',
    '噪音',
    '違停',
    '垃圾',
    '人行道',
  ],
  'reservation': ['叫號', '排隊', '預約', '臨櫃', '櫃台', '戶政', '區公所', '號碼', '等多久', '現場'],
  'disasterReport': [
    '災情',
    '淹水',
    '積水',
    '倒樹',
    '颱風',
    '地震',
    '坍方',
    '土石',
    '停電',
    '危險',
    '通報',
  ],
  'library': ['借書', '還書', '圖書館', '書', '館藏', '續借'],
  'locationSearch': [
    '附近',
    '地點',
    '哪裡',
    '廁所',
    '無障礙',
    '電梯',
    '停車',
    '公園',
    '怎麼去',
    '地圖',
    '設施',
  ],
  'dedicatedLine': ['電話', '打電話', '客服', '問人', '專人', '熱線', '不知道', '不會用', '幫忙'],
  'dashboard': ['數據', '統計', '空氣', '資料'],
};

const List<String> searchExamples = [
  '預約臨櫃',
  '路燈壞了',
  '家門口淹水',
  '附近的無障礙廁所',
  '申請身障補助',
  '借書',
];

final RegExp _stripChars = RegExp('[\\s，。、！？!?,.;；:：「」『』（）()〔〕【】"\'’‘“”…~～]');
final RegExp _leadingFiller = RegExp('^(我要|我想|請問|要怎麼|怎麼|如何|幫我)+');

/// 比對前的正規化：臺→台、全形數字→半形、去掉空白與標點、轉小寫。
String normalizeText(String? s) {
  if (s == null) return '';
  final buffer = StringBuffer();
  for (final unit in s.replaceAll('臺', '台').codeUnits) {
    buffer.writeCharCode(
      unit >= 0xff10 && unit <= 0xff19 ? unit - 0xfee0 : unit,
    );
  }
  return buffer.toString().replaceAll(_stripChars, '').toLowerCase();
}

/// 規則搜尋：說到關鍵字 +（2＋字數，最多 4），提到服務名稱 +5，與名稱或說明有相同的兩字詞 +1。最多 5 個。
List<SearchHit> ruleSearch(String query, List<SearchService> catalog) {
  final q = normalizeText(query).replaceFirst(_leadingFiller, '');
  if (q.isEmpty) return const [];
  final out = <SearchHit>[];
  for (final sv in catalog) {
    var score = 0;
    final reasons = <String>[];
    for (final k in serviceKeywords[sv.id] ?? const <String>[]) {
      if (q.contains(normalizeText(k))) {
        score += 2 + math.min(k.length, 4);
        reasons.add(k);
      }
    }
    final title = normalizeText(sv.title);
    if (q.contains(title) || (q.length >= 2 && title.contains(q))) {
      score += 5;
      if (!reasons.contains(sv.title)) reasons.add(sv.title);
    }
    final hay = title + normalizeText(sv.desc);
    for (var i = 0; i + 1 < q.length; i++) {
      if (hay.contains(q.substring(i, i + 2))) score += 1;
    }
    if (score > 0) {
      out.add(
        SearchHit(
          service: sv,
          score: score.toDouble(),
          reasons: reasons.take(3).toList(),
        ),
      );
    }
  }
  return _stableTop(out);
}

/// 把語意相似度（[scores]：服務 id → 相似度）與規則結果合併排序，最多 5 個。
///
/// 看「這一題裡最突出的服務比平均高幾個標準差」（z 值），而不是固定門檻：
/// 這個模型的相似度擠在很窄的範圍（不相關的題也有 0.84～0.89）。
/// 分數不可用（null、太少、全部相同）就原封不動回傳規則結果。
List<SearchHit> mergeRanking(
  List<SearchHit> ruleHits,
  Map<String, double>? scores,
  List<SearchService> catalog, {
  SemanticConfig cfg = defaultSemanticConfig,
}) {
  if (scores == null) return ruleHits;
  final vals = <double>[];
  for (final sv in catalog) {
    final s = scores[sv.id];
    if (s != null && s.isFinite) vals.add(s);
  }
  if (vals.length < cfg.minScores) return ruleHits;
  final mean = vals.reduce((a, b) => a + b) / vals.length;
  final variance =
      vals.map((v) => (v - mean) * (v - mean)).reduce((a, b) => a + b) /
      vals.length;
  final sd = math.sqrt(variance);
  if (!(sd > 1e-6)) return ruleHits;
  final confident = (vals.reduce(math.max) - mean) / sd >= cfg.abstainZ;

  final byId = {for (final h in ruleHits) h.service.id: h};
  final out = <SearchHit>[];
  for (final sv in catalog) {
    final s = scores[sv.id];
    final z = s != null && s.isFinite
        ? (s - mean) / sd
        : double.negativeInfinity;
    final rule = byId[sv.id];
    final named = rule != null && rule.reasons.isNotEmpty;
    final sem = confident
        ? ((z - cfg.showZ) / (cfg.fullZ - cfg.showZ)).clamp(0.0, 1.0)
        : 0.0;
    if (sem <= 0 && !named) continue;
    final ruleNorm = rule != null ? math.min(rule.score, 8) / 8 : 0.0;
    out.add(
      SearchHit(
        service: sv,
        score: cfg.weight * sem + (1 - cfg.weight) * ruleNorm,
        reasons: rule?.reasons ?? const [],
        semantic: sem > 0,
      ),
    );
  }
  return _stableTop(out);
}

/// 分數高的在前、同分維持原順序（Dart 的 sort 不保證穩定，所以自己帶序號）。最多 5 個。
List<SearchHit> _stableTop(List<SearchHit> hits) {
  final indexed = [for (var i = 0; i < hits.length; i++) (i, hits[i])];
  indexed.sort((a, b) {
    final c = b.$2.score.compareTo(a.$2.score);
    return c != 0 ? c : a.$1.compareTo(b.$1);
  });
  return [for (final e in indexed.take(5)) e.$2];
}
