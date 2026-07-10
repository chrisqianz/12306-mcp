---
name: 12306-train-tickets
description: 查询 12306 火车票信息。当用户询问火车票、余票、车站、列车时刻、中转票、经停站时使用。触发词包括"查票"、"余票"、"火车票"、"12306"、"车站"、"列车时刻"、"中转"、"经停"等。
---

# 12306 火车票查询 Skill

## 概述

通过独立脚本 `12306.mjs` 查询 12306 实时火车票信息。脚本零依赖，使用 Node.js 原生 `fetch`。

**脚本路径**: `./12306.mjs`（与本 SKILL.md 同目录）

## 安装说明

### 方式 1：使用 skills 工具安装（推荐）
```bash
# 从 GitHub 安装
npx skills add Joooook/12306-mcp

# 从本地项目安装
npx skills add ./skills
```

### 方式 2：手动安装
```bash
# 在项目根目录执行
# 方式 A：软链接（推荐，更新自动同步）
ln -s $(pwd)/skills ~/.pi/agent/skills/12306-train-tickets

# 方式 B：复制（独立副本）
cp -r skills ~/.pi/agent/skills/12306-train-tickets
```

## 命令列表

| 命令 | 参数 | 说明 |
|------|------|------|
| `date` | 无 | 获取当前日期（上海时区，yyyy-MM-dd） |
| `stations [城市]` | 可选城市名 | 获取车站编码列表，可选按城市过滤 |
| `search <关键字>` | 中文关键字 | 搜索车站名称 |
| `tickets <日期> <出发站> <到达站> [选项]` | 日期和车站(支持中文名或编码) | 查询余票 |
| `interline <日期> <出发站> <到达站> [中转站] [选项]` | 日期和车站 | 查询中转方案 |
| `route <车次> <日期>` | 车次和日期 | 查询经停站 |
| `refresh-cache` | 无 | 刷新本地缓存（车站数据和中转路径） |

## 选项说明

| 选项 | 说明 | 示例 |
|------|------|------|
| `--flags=G` | 车次筛选 (G/D/Z/T/K) | `--flags=G` (高铁), `--flags=D` (动车), `--flags=GD` (高铁+动车) |
| `--earliest=8` | 最早出发时间(0-24) | `--earliest=8` |
| `--latest=18` | 最迟出发时间(0-24) | `--latest=18` |
| `--sort=startTime` | 排序方式(startTime/arriveTime/duration) | `--sort=startTime` |
| `--limit=10` | 结果数量限制 | `--limit=10` |
| `--reverse` | 反向排序 | `--reverse` |

## 使用示例

### 查询余票
```javascript
ctx_execute({
  language: 'javascript',
  code: `
    const { execSync } = require('child_process');
    const path = require('path');
    
    // 获取 skill 目录（与 SKILL.md 同目录）
    const skillDir = path.join(process.cwd(), 'skills', '12306-train-tickets');
    const script = path.join(skillDir, '12306.mjs');
    
    // 获取当前日期
    const today = execSync(\`node \${script} date\`, { encoding: 'utf8' }).trim();
    
    // 查询余票(支持中文站名)
    const tickets = JSON.parse(execSync(
      \`node \${script} tickets \${today} 扬州东 合肥南 --flags=D --sort=startTime --limit=5\`,
      { encoding: 'utf8' }
    ));
    
    console.log(tickets.tickets.map(t => 
      \`\${t.station_train_code} \${t.start_time} → \${t.arrive_time} 历时 \${t.lishi}\`
    ).join('\n'));
  `
});
```

### 搜索车站
```javascript
ctx_execute({
  language: 'javascript',
  code: `
    const { execSync } = require('child_process');
    const path = require('path');
    
    const skillDir = path.join(process.cwd(), 'skills', '12306-train-tickets');
    const script = path.join(skillDir, '12306.mjs');
    
    const result = execSync(\`node \${script} search 北京\`, { encoding: 'utf8' });
    console.log(result);
  `
});
```

### 查询中转票
```javascript
ctx_execute({
  language: 'javascript',
  code: `
    const { execSync } = require('child_process');
    const path = require('path');
    
    const skillDir = path.join(process.cwd(), 'skills', '12306-train-tickets');
    const script = path.join(skillDir, '12306.mjs');
    
    const result = execSync(\`node \${script} interline 2026-07-11 VNP AOH --limit=10\`, {
      encoding: 'utf8'
    });
    console.log(result);
  `
});
```

### 查询列车经停站
```javascript
ctx_execute({
  language: 'javascript',
  code: `
    const { execSync } = require('child_process');
    const path = require('path');
    
    const skillDir = path.join(process.cwd(), 'skills', '12306-train-tickets');
    const script = path.join(skillDir, '12306.mjs');
    
    const result = execSync(\`node \${script} route G547 2026-07-11\`, {
      encoding: 'utf8'
    });
    console.log(result);
  `
});
```

## 工作流程

### 余票查询流程
1. 调用 `date` 获取当前日期（用户提到相对日期时）
2. 调用 `stations` 或 `search` 获取车站编码
3. 调用 `tickets` 查询余票，可使用选项筛选
4. 解析返回的车票数据，格式化输出

### 中转票查询流程
1. 获取当前日期和车站编码
2. 调用 `interline` 查询中转方案
3. 解析返回的中转路线信息

## 输出格式

所有命令输出 JSON 格式到 stdout，错误输出到 stderr。

### tickets 返回示例
```json
{
  "tickets": [
    {
      "status": "预订",
      "train_no": "240000G54700",
      "station_train_code": "G547",
      "start_time": "06:18",
      "arrive_time": "12:11",
      "lishi": "05:53",
      "date": "20260711"
    }
  ],
  "map": {
    "VNP": "北京南",
    "AOH": "上海虹桥"
  },
  "query": {
    "from": "VNP",
    "to": "AOH"
  }
}
```

### stations 返回示例
```json
{
  "VNP": {
    "station_name": "北京南",
    "station_code": "VNP",
    "city": "北京"
  }
}
```

## 注意事项

- 脚本零依赖，直接使用 `node` 运行
- 需要网络访问权限请求 12306 服务器
- 车站编码为 3 位大写字母（如 VNP=北京南, AOH=上海虹桥），但命令支持中文站名
- 日期格式必须为 `yyyy-MM-dd`
- 查询频率不宜过高，避免被服务器限制
- 12306 可能返回空结果或错误，需处理异常情况

## 缓存机制

脚本使用本地缓存来减少重复请求：

- **缓存文件**: `skills/stations.json` 和 `skills/lcquery_path`
- **缓存有效期**: 1 天
- **缓存内容**: 车站数据和中转查询路径

首次运行时会从 12306 服务器获取数据并缓存到本地。后续查询将使用缓存数据，速度更快。

### 手动刷新缓存

```bash
node skills/12306.mjs refresh-cache
```

当缓存过期或需要强制刷新时，使用此命令重新获取最新数据。