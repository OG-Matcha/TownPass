// 看護模式：路上（一步一步、求助）可以切成印尼語。臺北市的外籍看護 74% 是印尼籍。
// 站名、出口編號維持中文：現場指標是中文，看護要對照的是同一組字。
// 給站務人員看的求助卡永遠是中文（同一張卡同時給兩個人看）。
// 翻譯由開發團隊撰寫，尚未經母語者校對（README 已註明）。
import { computed } from "vue";
import type { Line } from "./route.ts";
import { lang } from "./settings.ts";

export type Lang = "zh" | "id";

const LINE_ID: Record<Line, string> = {
  R: "Jalur Merah (淡水信義線)",
  BR: "Jalur Cokelat (文湖線)",
  BL: "Jalur Biru (板南線)",
  G: "Jalur Hijau (松山新店線)",
  O: "Jalur Oranye (中和新蘆線)",
  Y: "Jalur Kuning (環狀線)",
};
export const lineId = (l: Line) => LINE_ID[l];

/** 「2號出口（電梯）、M5出口（坡道）」→「Pintu 2 (lift), Pintu M5 (ramp)」 */
export const exitsId = (exits: { exit: string; kind: string }[]) =>
  exits.map((e) => `Pintu ${e.exit.replace(/號?出口$/, "")} (${e.kind === "ramp" ? "ramp" : "lift"})`).join(", ");

/** 「第1節、第4節車廂」→「gerbong 1 dan 4」 */
export const carsId = (cars: string) => {
  const n = cars.match(/\d+/g);
  return n ? `gerbong ${n.join(" dan ")}` : cars;
};

/** 「左側開門」→「pintu kiri terbuka」；其他說法保留原文 */
export const doorId = (door: string) =>
  door === "左側開門" ? "pintu kiri terbuka" : door === "右側開門" ? "pintu kanan terbuka" : door.includes("兩側") ? "pintu bisa terbuka di kiri atau kanan" : door;

const PATH_WORDS: [RegExp, string][] = [
  [/出口電梯/g, "lift pintu keluar"],
  [/無障礙閘門/g, "gerbang tiket aksesibel"],
  [/無障礙電梯/g, "lift"],
  [/電梯/g, "lift"],
  [/大廳/g, "lobi"],
  [/月[臺台]/g, "peron"],
  [/(\d+)樓/g, "lantai $1 "],
  [/地下/g, "bawah tanah "],
];
/** 動線關鍵詞換成印尼語；認不出的部分保留中文（給看護對照指標）。 */
export function pathId(p: string) {
  let s = p;
  for (const [re, to] of PATH_WORDS) s = s.replace(re, to);
  return s.replace(/\s+/g, " ").trim();
}

/** 介面文字。路上畫面用 t.value.xxx。 */
const ZH = {
  stepOf: (i: number, n: number) => `第 ${i} 步，共 ${n} 步`,
  speak: "唸給我聽",
  speaking: "正在唸",
  talk: "用講的",
  listening: "請說話…",
  cantFind: "找不到電梯",
  talkHint: "可以說：「下一步」「唸」「找不到電梯」「放大」",
  notUnderstood: (t: string) => `聽到「${t}」，聽不懂。可以說：「下一步」「唸」「找不到電梯」`,
  okStatus: "電梯狀況：",
  warnStatus: "注意：",
  allSteps: "全部步驟",
  end: "結束這趟",
  showStaff: "給站務人員看的求助卡",
  callMetro: "打給北捷客服",
  stillCant: "還是找不到？",
  whereElevator: (s: string) => `${s}的電梯在哪裡`,
  exitsLabel: "有電梯或坡道的出口",
  gateLabel: "無障礙閘門",
  gateNote: "（閘門有服務鈴，可以找站務人員）",
  pathLabel: "進出站電梯動線",
  close: "關閉",
  cardFor: "",
  askTitle: "比預計時間晚了，還好嗎？",
  askDesc: "找不到電梯的話，下面可以找人幫忙。",
  imOk: "我沒事",
  askCant: "我找不到電梯",
  needHelp: "我需要幫忙",
  nowStep: "現在這一步：",
  bigger: "放大字",
  biggerDone: "字放大了。",
  movedTo: (i: number) => `第 ${i} 步。`,
  undoHint: "說「上一步」可以回來。",
  backDone: "回到上一步。",
  paused: "好，先不念了。要繼續，按「用講的」說繼續。",
  resumed: "好，繼續。",
  confirmEnd: "要結束這趟嗎？說「確定」結束，說「不要」繼續。",
  keepGoing: "好，繼續這趟。",
  early: "比預計早很多，確定要往下一步嗎？說「對」確認。",
  earlyHold: "比預計早很多。真的到了就再長按一次，還沒到就不用理它。",
  earlyTap: "比預計早很多，確定要往下一步嗎？",
  earlyYes: "對，到了",
  earlyNo: "還沒",
  endYes: "結束這趟",
  endNo: "不用",
  nextYes: "下一步",
  askAgain: "我沒聽懂。要下一步，還是再聽一次？",
  soon: (s: string) => `快到${s}了，準備下車。`,
  due: (s: string) => `到${s}了嗎？到了就說「到了」。`,
  arrivedAll: "到了，這趟結束。",
  holdHint: "長按螢幕任何地方一秒，換下一步",
  // 出發時問一次怎麼帶路
  modeTitle: "路上你想怎麼知道下一步？",
  modeLook: "看畫面就好",
  modeLookSub: "一次一步，看完按下一步",
  modeListen: "唸給我聽",
  modeListenSub: "自動唸、快到站提醒；長按螢幕換下一步",
  modeTalk: "唸給我聽，我用講的",
  modeTalkSub: "唸完自動聽你說「到了」，不用按",
  modeDontAsk: "下次不要再問",
  // 需要幫忙：先分流
  helpTool: "需要幫忙",
  helpTitle: "發生什麼事？",
  helpBroken: "電梯不能用，幫我換一條路",
  helpBrokenSub: "壞了、維修中、排太久",
  helpFind: "我找不到電梯",
  helpFindSub: "告訴我電梯在哪裡",
  helpStaff: "請站務人員來幫我",
  helpStaffSub: "給站務人員看的卡片、打電話",
  report1999: "向 1999 反映設施故障",
  switchTitle: "要結束現在這趟，改走新的嗎？",
  switchYes: "結束這趟，改走新的",
  switchNo: "繼續原本這趟",
  helpAsk: "發生什麼事？電梯不能用，找不到電梯，還是請站務人員來？",
  whichExit: (s: string) => `${s}哪一個出口的電梯不能用？`,
  allBroken: "這站的電梯都不能用",
  allBrokenSub: "改去別站",
  noReroute: (s: string) => `找不到可以避開${s}這部電梯的路。`,
  noRerouteSay: "找不到別的路，請站務人員來幫忙。",
  rerouted: "已換一條路",
  undoReroute: "已換一條路",
  carsLabel: "輪椅停靠車廂",
  changeExit: (e: string, enter: boolean) => `改從${e}${enter ? "進站" : "出站"}`,
  changeOrigin: (s: string, m: number) => `改從${s}進站（直線約 ${m} 公尺）`,
  changeDest: (s: string, m: number) => `改到${s}出站（出口離原本的站直線約 ${m} 公尺）`,
  changeTransfer: (via: string[], dest: string) => (via.length ? `改在${via.join("、")}轉乘` : `不用轉乘，直接坐到${dest}`),
  notifyFamily: "讓家人知道我需要幫忙",
  eta: (n: number, remind: boolean) => `約 ${n} 分鐘後到${remind ? "・到了會提醒你" : ""}`,
  etaDue: "差不多到了",
  pathToggle: "電梯怎麼走",
};
const ID: typeof ZH = {
  stepOf: (i, n) => `Langkah ${i} dari ${n}`,
  speak: "Bacakan",
  speaking: "Sedang membaca",
  talk: "Bicara",
  listening: "Silakan bicara…",
  cantFind: "Lift tidak ketemu",
  talkHint: "Bisa bilang: \"lanjut\", \"baca\", \"tolong\"",
  notUnderstood: (t) => `Terdengar "${t}", tidak dimengerti. Bisa bilang: "lanjut", "baca", "tolong"`,
  okStatus: "Status lift: ",
  warnStatus: "Perhatian: ",
  allSteps: "Semua langkah",
  end: "Selesai perjalanan",
  showStaff: "Kartu bantuan untuk petugas stasiun",
  callMetro: "Telepon layanan MRT Taipei",
  stillCant: "Masih tidak ketemu?",
  whereElevator: (s) => `Lift di stasiun ${s}`,
  exitsLabel: "Pintu keluar dengan lift atau ramp",
  gateLabel: "Gerbang tiket aksesibel",
  gateNote: " (ada bel layanan, bisa panggil petugas)",
  pathLabel: "Rute lift masuk/keluar",
  close: "Tutup",
  cardFor: "Tunjukkan layar ini kepada petugas stasiun. Tulisan Mandarin di bawah menjelaskan kebutuhan Anda.",
  askTitle: "Sudah lewat dari perkiraan waktu. Semua baik?",
  askDesc: "Kalau lift tidak ketemu, ada bantuan di bawah.",
  imOk: "Saya baik-baik saja",
  askCant: "Saya tidak menemukan lift",
  needHelp: "Saya butuh bantuan",
  nowStep: "Langkah sekarang: ",
  bigger: "Perbesar",
  biggerDone: "Tulisan diperbesar.",
  movedTo: (i) => `Langkah ${i}.`,
  undoHint: "Bilang \"kembali\" untuk mundur.",
  backDone: "Kembali ke langkah sebelumnya.",
  paused: "Baik, berhenti membaca. Untuk lanjut, tekan Bicara dan bilang lanjut.",
  resumed: "Baik, lanjut.",
  confirmEnd: "Selesai perjalanan? Bilang \"ya\" untuk selesai, \"tidak\" untuk lanjut.",
  keepGoing: "Baik, perjalanan lanjut.",
  early: "Ini lebih cepat dari perkiraan. Yakin ke langkah berikutnya? Bilang \"ya\".",
  earlyHold: "Ini lebih cepat dari perkiraan. Kalau sudah sampai, tekan lama sekali lagi. Kalau belum, abaikan saja.",
  earlyTap: "Ini lebih cepat dari perkiraan. Yakin ke langkah berikutnya?",
  earlyYes: "Ya, sudah sampai",
  earlyNo: "Belum",
  endYes: "Selesai",
  endNo: "Tidak",
  nextYes: "Langkah berikutnya",
  askAgain: "Saya tidak mengerti. Mau lanjut, atau dengar lagi?",
  soon: (s) => `Sebentar lagi sampai ${s}. Siap turun.`,
  due: (s) => `Sudah sampai ${s}? Kalau sudah, bilang \"sudah\".`,
  arrivedAll: "Sudah sampai. Perjalanan selesai.",
  holdHint: "Tekan lama di mana saja selama satu detik untuk lanjut",
  modeTitle: "Bagaimana Anda ingin tahu langkah berikutnya?",
  modeLook: "Lihat layar saja",
  modeLookSub: "Satu langkah sekali, tekan lanjut",
  modeListen: "Bacakan untuk saya",
  modeListenSub: "Dibacakan otomatis, diingatkan sebelum sampai; tekan lama layar untuk lanjut",
  modeTalk: "Bacakan, saya jawab dengan suara",
  modeTalkSub: "Setelah dibacakan, langsung mendengar \"sudah\" tanpa menekan",
  modeDontAsk: "Jangan tanya lagi",
  helpTool: "Butuh bantuan",
  helpTitle: "Apa yang terjadi?",
  helpBroken: "Lift tidak bisa dipakai, cari rute lain",
  helpBrokenSub: "Rusak, sedang diperbaiki, antre terlalu lama",
  helpFind: "Saya tidak menemukan lift",
  helpFindSub: "Beri tahu di mana lift-nya",
  helpStaff: "Panggil petugas stasiun",
  helpStaffSub: "Kartu untuk petugas, telepon",
  report1999: "Laporkan fasilitas rusak ke 1999",
  switchTitle: "Akhiri perjalanan ini dan ganti ke rute baru?",
  switchYes: "Akhiri, ganti rute baru",
  switchNo: "Lanjut perjalanan ini",
  helpAsk: "Apa yang terjadi? Lift tidak bisa dipakai, lift tidak ketemu, atau panggil petugas?",
  whichExit: (s) => `Lift pintu mana di ${s} yang tidak bisa dipakai?`,
  allBroken: "Semua lift di stasiun ini tidak bisa dipakai",
  allBrokenSub: "Pindah ke stasiun lain",
  noReroute: (s) => `Tidak ada rute lain yang menghindari lift di ${s}.`,
  noRerouteSay: "Tidak ada rute lain. Silakan panggil petugas stasiun.",
  rerouted: "Rute sudah diganti",
  undoReroute: "Rute sudah diganti",
  carsLabel: "Gerbong kursi roda",
  changeExit: (e, enter) => `${enter ? "Masuk" : "Keluar"} lewat ${e}`,
  changeOrigin: (s, m) => `Masuk dari ${s} (jarak lurus sekitar ${m} meter)`,
  changeDest: (s, m) => `Keluar di ${s} (jarak lurus sekitar ${m} meter dari stasiun semula)`,
  changeTransfer: (via, dest) => (via.length ? `Pindah kereta di ${via.join(", ")}` : `Tanpa pindah, langsung ke ${dest}`),
  notifyFamily: "Beri tahu keluarga saya butuh bantuan",
  eta: (n, remind) => `Sekitar ${n} menit lagi sampai${remind ? " · nanti diingatkan" : ""}`,
  etaDue: "Seharusnya hampir sampai",
  pathToggle: "Rute lift",
};
export const t = computed(() => (lang.value === "id" ? ID : ZH));
/** TTS／語音辨識用的語系 */
export const speechLocale = computed(() => (lang.value === "id" ? "id-ID" : "zh-TW"));
