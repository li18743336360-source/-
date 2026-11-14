# iPhone 收货行情

每天自动更新的苹果二手分级回收行情，外加一个帮你判断二手平台上的商品值不值得收的小工具。纯静态网页，托管在 GitHub Pages，不需要服务器。

## 它做什么

**行情**　每天自动读取两家韩国回收商公开的回收报价表，整理成统一的机型、容量、等级：

| 来源 | 等级 | 说明 |
| --- | --- | --- |
| [Space Trade-in](https://space-tradein.co.kr/sub/price_list.php)（스페이스 트레이드인） | A / B / C / D / E | 含破损、故障机的报价；新机型上架快 |
| [Rediva](https://rediva.ai/price)（리디바） | A / A- / B+ / B | 只报功能正常的机器 |

目前覆盖 iPhone 7 到 iPhone 18 Pro Max 共 40 款。近 7 天内调过价的会标出涨跌。

**收货助手**　填上每台想赚多少，页面算出每个机型今天的收货上限价（回收价 − 目标利润 − 其他成本），并提供：

- 一键打开当根、번개장터、중고나라 的搜索结果（当根带上价格上限和「只看在售」）；
- 粘贴判定：把标题和价格粘贴进来，自动认机型、容量和成色线索（未拆封、屏幕破损、残影、电池健康度等），算出按各等级回收能赚多少。

**说明**　两家回收商的等级标准对照、数据来源和使用注意事项。

## 关于当根（당근）

当根的 `robots.txt` 明确禁止程序抓取搜索结果页（`/kr/buy-sell/s/`），搜索列表还有反爬验证。所以这个项目**不自动抓取当根**，而是用「算好上限价 → 一键去搜 → 粘贴判定」的方式配合人工筛选。想盯新上架的商品，用当根 App 自带的「키워드 알림」（关键词提醒）。

## 开启网页（只需做一次）

1. 打开仓库的 **Settings → Pages**。
2. 在 **Build and deployment → Source** 里选择 **GitHub Actions**。
3. 打开 **Actions** 页，选左侧的「更新行情并发布网页」，点 **Run workflow**。
4. 跑完后网页地址是 `https://<你的用户名>.github.io/<仓库名>/`。

## 自动更新

`.github/workflows/update.yml` 在韩国时间每天 09:17、13:17、18:17 运行：

1. 跑单元测试；
2. 抓取两家回收商的公开价格页（约 60 个请求，每秒最多 1 个）；
3. 把结果写进 `site/data/prices.json` 和 `site/data/history.json`，每天第一次抓取或价格有变化时提交回仓库；
4. 发布到 GitHub Pages。

某个来源抓取失败时会沿用它上一次的数据，并在网页顶部提示。数据超过 36 小时没更新，网页也会提示。

> GitHub 会暂停 60 天没有任何活动的公开仓库里的定时任务。这个工作流每天都会提交一次数据，正常情况下不会触发；如果被暂停了，到 Actions 页重新启用即可。

## 在自己电脑上运行

需要 Node.js 20 或更高版本，没有任何第三方依赖。

```bash
npm test         # 单元测试
npm run fetch    # 抓取当日行情，写入 site/data/
npm run serve    # 本地预览 http://localhost:8080
```

## 目录

```
site/                    网页本体（GitHub Pages 发布这个目录）
  index.html
  assets/catalog.js      机型目录：名称、韩文搜索词、合法容量
  assets/core.js         标题识别、价格解析、收货判定（网页和脚本共用）
  assets/app.js          页面交互
  assets/styles.css
  data/prices.json       当日行情（自动生成）
  data/history.json      调价历史（自动生成）
scripts/
  fetch-prices.mjs       抓取入口
  lib/sources/           每个行情来源一个模块
  lib/merge.mjs          合并来源、记录涨跌
  serve.mjs              本地预览
  build-artifact.mjs     打成单文件版（发布 Claude Artifact 预览时用）
test/                    单元测试与取自真实页面的样本
```

## 想改点什么

- **更新时间**：改 `.github/workflows/update.yml` 里的 `cron`（用的是 UTC）。
- **新机型**：行情站一上架就会自动收录。想给它规范的名称和韩文搜索词，在 `site/assets/catalog.js` 里加一行。
- **新的行情来源**：在 `scripts/lib/sources/` 里加一个模块，导出 `SOURCE` 和 `fetchAll`，再登记到 `scripts/fetch-prices.mjs` 的 `ALL_SOURCES`。
- **识别规则**：标题里的关键词规则在 `site/assets/core.js`，对应的测试在 `test/core.test.mjs`。

## 数据来源与使用边界

- 只读取两家网站 `robots.txt` 允许访问的公开价格页；抓取程序如实标识自己，串行请求、每秒最多 1 个。
- 表里是回收商的公开报价，最终成交价以对方验机定级为准。数据仅供参考。
