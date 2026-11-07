import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

// 「找服務」的語意比對核心。純 Dart，不碰 Flutter 與模型：
// 模型只透過 [TextEmbedder] 進來，所以單元測試可以換成假的，不用載入 165 MB 的檔案。
//
// 做法：每個服務有幾句「市民會怎麼說」的例句（tool/semantic_search/phrases.json），
// 先全部轉成向量存起來；使用者說一句話，轉成向量後和每個服務的每句例句比相似度，
// 該服務取最高的一句。向量的意思就是「句子在意思地圖上的座標」，座標越近意思越像。

/// 向量模型的最小介面。
abstract class TextEmbedder {
  /// 模型身分（含修訂版與用法）；換任何一項，舊的服務向量就不能用，快取鍵會跟著變。
  String get modelId;

  /// 把「服務這一邊的文字」（名稱、說明、例句）轉成向量。
  Future<List<double>> embedDocument(String text);

  /// 把「使用者的一句話」轉成向量。
  ///
  /// 文件與問題必須由同一顆模型、同樣的設定算出來，不然座標對不上。
  Future<List<double>> embedQuery(String text);
}

/// 一個服務要拿去比對的文字：名稱＋說明（一句）與例句。
class ServiceDoc {
  const ServiceDoc({required this.id, required this.texts});

  final String id;
  final List<String> texts;
}

/// 問題最長字數；再長的輸入不送進模型（模型也有 token 上限，超過會丟例外，不會截斷）。
const int maxQueryChars = 200;

/// 索引檔格式版本；改了序列化方式就加一，舊快取會自動失效。
const String serviceIndexFormat = 'service-index-v1';

/// 快取鍵：服務清單（含例句）＋模型身分＋格式版本。任何一項不同就要重算。
///
/// 用 FNV-1a 64 位元雜湊，只是為了比對「有沒有變」，不是安全用途。
String serviceIndexCacheKey({
  required List<ServiceDoc> docs,
  required String modelId,
  String format = serviceIndexFormat,
}) {
  final sorted = [...docs]..sort((a, b) => a.id.compareTo(b.id));
  final buffer = StringBuffer()
    ..write(format)
    ..write('\u0000')
    ..write(modelId);
  for (final doc in sorted) {
    buffer
      ..write('\u0000')
      ..write(doc.id);
    for (final text in doc.texts) {
      buffer
        ..write('\u0001')
        ..write(text);
    }
  }
  return fnv1a64Hex(utf8.encode(buffer.toString()));
}

/// FNV-1a 64 位元雜湊（16 位十六進位）。公開只為了能用標準測資驗證。
String fnv1a64Hex(List<int> bytes) {
  // 拆成兩個 32 位元來算，不依賴平台的 64 位元整數行為。
  var hi = 0xcbf29ce4;
  var lo = 0x84222325;
  const primeHi = 0x00000100;
  const primeLo = 0x000001b3;
  for (final byte in bytes) {
    lo ^= byte;
    // (hi:lo) *= (primeHi:primeLo) mod 2^64
    final loProduct = lo * primeLo;
    final carry = loProduct ~/ 0x100000000;
    final newLo = loProduct & 0xffffffff;
    final newHi = (hi * primeLo + lo * primeHi + carry) & 0xffffffff;
    hi = newHi;
    lo = newLo;
  }
  return hi.toRadixString(16).padLeft(8, '0') +
      lo.toRadixString(16).padLeft(8, '0');
}

/// 向量長度正規化成 1，之後內積就等於餘弦相似度。
Float32List normalizeVector(List<double> v) {
  var sum = 0.0;
  for (final x in v) {
    sum += x * x;
  }
  final norm = math.sqrt(sum);
  final out = Float32List(v.length);
  if (norm == 0 || norm.isNaN) return out; // 全 0：之後相似度都是 0，不會誤判成相近
  for (var i = 0; i < v.length; i++) {
    out[i] = v[i] / norm;
  }
  return out;
}

/// 兩個已正規化向量的內積。長度不同視為不可比，回 0。
double dotProduct(Float32List a, Float32List b) {
  if (a.length != b.length) return 0;
  var sum = 0.0;
  for (var i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/// 全部服務的例句向量。
class ServiceIndex {
  ServiceIndex({
    required this.key,
    required this.modelId,
    required this.dimension,
    required this.vectors,
  });

  final String key;
  final String modelId;
  final int dimension;

  /// 服務 id → 該服務每句例句的向量（已正規化）。
  final Map<String, List<Float32List>> vectors;

  Map<String, dynamic> toJson() => {
    'format': serviceIndexFormat,
    'key': key,
    'modelId': modelId,
    'dimension': dimension,
    'services': {
      for (final entry in vectors.entries)
        entry.key: [
          for (final v in entry.value)
            base64Encode(
              v.buffer.asUint8List(v.offsetInBytes, v.lengthInBytes),
            ),
        ],
    },
  };

  /// 解析快取；格式不對、鍵不符、維度不符一律回 null（呼叫端重算即可），不丟例外。
  static ServiceIndex? tryParse(Object? json, {required String expectedKey}) {
    try {
      if (json is! Map) return null;
      if (json['format'] != serviceIndexFormat || json['key'] != expectedKey) {
        return null;
      }
      final dimension = json['dimension'];
      final modelId = json['modelId'];
      final services = json['services'];
      if (dimension is! int ||
          dimension <= 0 ||
          modelId is! String ||
          services is! Map) {
        return null;
      }
      final vectors = <String, List<Float32List>>{};
      for (final entry in services.entries) {
        final list = entry.value;
        if (entry.key is! String || list is! List || list.isEmpty) return null;
        final parsed = <Float32List>[];
        for (final item in list) {
          if (item is! String) return null;
          final bytes = base64Decode(item);
          if (bytes.length != dimension * 4) return null;
          // 複製成自己的緩衝區，避免對齊問題
          parsed.add(
            Float32List.fromList(
              Uint8List.fromList(bytes).buffer.asFloat32List(),
            ),
          );
        }
        vectors[entry.key as String] = parsed;
      }
      if (vectors.isEmpty) return null;
      return ServiceIndex(
        key: expectedKey,
        modelId: modelId,
        dimension: dimension,
        vectors: vectors,
      );
    } catch (_) {
      return null;
    }
  }
}

/// 索引快取檔的讀寫。寫入先寫暫存檔再改名，App 中途被關掉也不會留下半個檔。
class ServiceIndexStore {
  const ServiceIndexStore(this.file);

  final File file;

  Future<ServiceIndex?> load({required String expectedKey}) async {
    try {
      if (!await file.exists()) return null;
      return ServiceIndex.tryParse(
        jsonDecode(await file.readAsString()),
        expectedKey: expectedKey,
      );
    } catch (_) {
      return null;
    }
  }

  Future<void> save(ServiceIndex index) async {
    final tmp = File('${file.path}.tmp');
    await tmp.parent.create(recursive: true);
    await tmp.writeAsString(jsonEncode(index.toJson()), flush: true);
    await tmp.rename(file.path);
  }
}

/// 建索引＋回答「這句話最像哪些服務」。
class ServiceRankEngine {
  ServiceRankEngine({required this.embedder, required this.index});

  final TextEmbedder embedder;
  final ServiceIndex index;

  /// 逐句轉成向量建立索引。[onProgress] 回報已完成句數與總句數。
  static Future<ServiceIndex> buildIndex({
    required TextEmbedder embedder,
    required List<ServiceDoc> docs,
    void Function(int done, int total)? onProgress,
  }) async {
    final total = docs.fold<int>(0, (sum, d) => sum + d.texts.length);
    var done = 0;
    var dimension = 0;
    final vectors = <String, List<Float32List>>{};
    for (final doc in docs) {
      final list = <Float32List>[];
      for (final text in doc.texts) {
        final v = normalizeVector(await embedder.embedDocument(text));
        if (v.isEmpty) throw StateError('向量模型回傳空向量');
        if (dimension == 0) dimension = v.length;
        if (v.length != dimension) {
          throw StateError('向量維度不一致：$dimension vs ${v.length}');
        }
        list.add(v);
        onProgress?.call(++done, total);
      }
      if (list.isNotEmpty) vectors[doc.id] = list;
    }
    return ServiceIndex(
      key: serviceIndexCacheKey(docs: docs, modelId: embedder.modelId),
      modelId: embedder.modelId,
      dimension: dimension,
      vectors: vectors,
    );
  }

  /// 每個服務的相似度（0～1 附近，越高越像）。[ids] 有給就只算這些服務。
  Future<Map<String, double>> rank(String query, {Set<String>? ids}) async {
    final q = query.trim();
    if (q.isEmpty) throw ArgumentError('問題是空的');
    if (q.length > maxQueryChars) throw ArgumentError('問題太長');
    final qv = normalizeVector(await embedder.embedQuery(q));
    if (qv.length != index.dimension) {
      throw StateError('問題向量維度 ${qv.length} 與索引 ${index.dimension} 不同');
    }
    final scores = <String, double>{};
    for (final entry in index.vectors.entries) {
      if (ids != null && !ids.contains(entry.key)) continue;
      var best = -1.0;
      for (final v in entry.value) {
        final s = dotProduct(qv, v);
        if (s > best) best = s;
      }
      // 取四位小數：網頁不需要更細，也少傳一些字
      scores[entry.key] = (best * 10000).round() / 10000;
    }
    return scores;
  }
}
