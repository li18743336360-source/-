// iPhone 机型目录。抓取脚本、网页、测试共用同一份。
//
// - id       统一机型编号（行情数据、关注列表都用它）
// - name     英文名（界面显示）
// - ko       韩文搜索词（去当根 / 번개장터 / 중고나라 搜索时用）
// - series   界面上的系列筛选
// - storages 该机型真实存在的容量；填了就只收这些容量的行情，
//            用来挡掉行情站偶尔出现的错误条目（例如并不存在的 iPhone 13 1TB）。
//            最新一代留空 = 行情站列什么就收什么。

export const STORAGE_ORDER = ['16GB', '32GB', '64GB', '128GB', '256GB', '512GB', '1TB', '2TB'];

export const SERIES = ['18', '17', '16', '15', '14', '13', '12', '11', '旧款'];

const S_64_128_256 = ['64GB', '128GB', '256GB'];
const S_64_256_512 = ['64GB', '256GB', '512GB'];
const S_128_256_512 = ['128GB', '256GB', '512GB'];
const S_128_TO_1TB = ['128GB', '256GB', '512GB', '1TB'];
const S_256_TO_1TB = ['256GB', '512GB', '1TB'];

export const MODELS = [
  { id: 'iphone-18-pro-max', name: 'iPhone 18 Pro Max', ko: '아이폰 18 프로맥스', series: '18', storages: null },
  { id: 'iphone-18-pro', name: 'iPhone 18 Pro', ko: '아이폰 18 프로', series: '18', storages: null },

  { id: 'iphone-17-pro-max', name: 'iPhone 17 Pro Max', ko: '아이폰 17 프로맥스', series: '17', storages: ['256GB', '512GB', '1TB', '2TB'] },
  { id: 'iphone-17-pro', name: 'iPhone 17 Pro', ko: '아이폰 17 프로', series: '17', storages: S_256_TO_1TB },
  { id: 'iphone-air', name: 'iPhone Air', ko: '아이폰 에어', series: '17', storages: S_256_TO_1TB, aliases: ['iphone17air'] },
  { id: 'iphone-17', name: 'iPhone 17', ko: '아이폰 17', series: '17', storages: ['256GB', '512GB'] },

  { id: 'iphone-16-pro-max', name: 'iPhone 16 Pro Max', ko: '아이폰 16 프로맥스', series: '16', storages: S_256_TO_1TB },
  { id: 'iphone-16-pro', name: 'iPhone 16 Pro', ko: '아이폰 16 프로', series: '16', storages: S_128_TO_1TB },
  { id: 'iphone-16-plus', name: 'iPhone 16 Plus', ko: '아이폰 16 플러스', series: '16', storages: S_128_256_512 },
  { id: 'iphone-16', name: 'iPhone 16', ko: '아이폰 16', series: '16', storages: S_128_256_512 },
  { id: 'iphone-16e', name: 'iPhone 16e', ko: '아이폰 16e', series: '16', storages: S_128_256_512 },

  { id: 'iphone-15-pro-max', name: 'iPhone 15 Pro Max', ko: '아이폰 15 프로맥스', series: '15', storages: S_256_TO_1TB },
  { id: 'iphone-15-pro', name: 'iPhone 15 Pro', ko: '아이폰 15 프로', series: '15', storages: S_128_TO_1TB },
  { id: 'iphone-15-plus', name: 'iPhone 15 Plus', ko: '아이폰 15 플러스', series: '15', storages: S_128_256_512 },
  { id: 'iphone-15', name: 'iPhone 15', ko: '아이폰 15', series: '15', storages: S_128_256_512 },

  { id: 'iphone-14-pro-max', name: 'iPhone 14 Pro Max', ko: '아이폰 14 프로맥스', series: '14', storages: S_128_TO_1TB },
  { id: 'iphone-14-pro', name: 'iPhone 14 Pro', ko: '아이폰 14 프로', series: '14', storages: S_128_TO_1TB },
  { id: 'iphone-14-plus', name: 'iPhone 14 Plus', ko: '아이폰 14 플러스', series: '14', storages: S_128_256_512 },
  { id: 'iphone-14', name: 'iPhone 14', ko: '아이폰 14', series: '14', storages: S_128_256_512 },

  { id: 'iphone-13-pro-max', name: 'iPhone 13 Pro Max', ko: '아이폰 13 프로맥스', series: '13', storages: S_128_TO_1TB },
  { id: 'iphone-13-pro', name: 'iPhone 13 Pro', ko: '아이폰 13 프로', series: '13', storages: S_128_TO_1TB },
  { id: 'iphone-13', name: 'iPhone 13', ko: '아이폰 13', series: '13', storages: S_128_256_512 },
  { id: 'iphone-13-mini', name: 'iPhone 13 mini', ko: '아이폰 13 미니', series: '13', storages: S_128_256_512 },

  { id: 'iphone-12-pro-max', name: 'iPhone 12 Pro Max', ko: '아이폰 12 프로맥스', series: '12', storages: S_128_256_512 },
  { id: 'iphone-12-pro', name: 'iPhone 12 Pro', ko: '아이폰 12 프로', series: '12', storages: S_128_256_512 },
  { id: 'iphone-12', name: 'iPhone 12', ko: '아이폰 12', series: '12', storages: S_64_128_256 },
  { id: 'iphone-12-mini', name: 'iPhone 12 mini', ko: '아이폰 12 미니', series: '12', storages: S_64_128_256 },

  { id: 'iphone-11-pro-max', name: 'iPhone 11 Pro Max', ko: '아이폰 11 프로맥스', series: '11', storages: S_64_256_512 },
  { id: 'iphone-11-pro', name: 'iPhone 11 Pro', ko: '아이폰 11 프로', series: '11', storages: S_64_256_512 },
  { id: 'iphone-11', name: 'iPhone 11', ko: '아이폰 11', series: '11', storages: S_64_128_256 },

  { id: 'iphone-se-3', name: 'iPhone SE 3', ko: '아이폰 SE3', series: '旧款', storages: S_64_128_256, aliases: ['iphonese3세대', 'iphonese(3세대)', 'iphonese2022'] },
  { id: 'iphone-se-2', name: 'iPhone SE 2', ko: '아이폰 SE2', series: '旧款', storages: S_64_128_256, aliases: ['iphonese2세대', 'iphonese(2세대)', 'iphonese2020'] },
  { id: 'iphone-xs-max', name: 'iPhone XS Max', ko: '아이폰 XS 맥스', series: '旧款', storages: S_64_256_512 },
  { id: 'iphone-xs', name: 'iPhone XS', ko: '아이폰 XS', series: '旧款', storages: S_64_256_512 },
  { id: 'iphone-xr', name: 'iPhone XR', ko: '아이폰 XR', series: '旧款', storages: S_64_128_256 },
  { id: 'iphone-x', name: 'iPhone X', ko: '아이폰 X', series: '旧款', storages: ['64GB', '256GB'] },
  { id: 'iphone-8-plus', name: 'iPhone 8 Plus', ko: '아이폰 8 플러스', series: '旧款', storages: S_64_128_256 },
  { id: 'iphone-8', name: 'iPhone 8', ko: '아이폰 8', series: '旧款', storages: S_64_128_256 },
  { id: 'iphone-7-plus', name: 'iPhone 7 Plus', ko: '아이폰 7 플러스', series: '旧款', storages: ['32GB', '128GB', '256GB'] },
  { id: 'iphone-7', name: 'iPhone 7', ko: '아이폰 7', series: '旧款', storages: ['32GB', '128GB', '256GB'] },
];

export const MODEL_BY_ID = new Map(MODELS.map((m) => [m.id, m]));

// 默认关注的机型（用户点名的三款）。
export const DEFAULT_WATCH = ['iphone-18-pro-max', 'iphone-18-pro', 'iphone-17-pro-max'];
