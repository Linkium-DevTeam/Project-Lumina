/** 心理援助热线数据：救助卡片与求助弹窗共用。 */

export interface Hotline {
  name: string;
  phone: string;
  note: string;
  /** 青少年专属：只在卡片判定对方可能是未成年人时展示 */
  minorOnly?: boolean;
}

export const HOTLINES: Hotline[] = [
  {
    name: "全国心理援助热线",
    phone: "12356",
    note: "24 小时 · 全国统一",
  },
  {
    name: "12355 青少年服务台",
    phone: "12355",
    note: "共青团 · 心理与法律服务",
    minorOnly: true,
  },
  {
    name: "希望24热线",
    phone: "400-161-9995",
    note: "24 小时 · 生命教育与危机干预",
  },
  {
    name: "北京心理危机研究与干预中心",
    phone: "010-82951332",
    note: "24 小时",
  },
];

export function hotlinesFor(minor?: boolean): Hotline[] {
  return HOTLINES.filter((h) => !h.minorOnly || minor);
}
