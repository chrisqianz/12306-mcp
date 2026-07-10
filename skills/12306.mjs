#!/usr/bin/env node
// 12306 火车票查询 - 独立脚本，零外部依赖
// 用法: node 12306.mjs <命令> [参数]
// 依赖: Node.js 18+ (原生 fetch)

const API_BASE = 'https://kyfw.12306.cn';
const SEARCH_API_BASE = 'https://search.12306.cn';
const WEB_URL = 'https://www.12306.cn/index/';
const LCQUERY_INIT_URL = 'https://kyfw.12306.cn/otn/lcQuery/init';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

// 座位类型映射
const SEAT_TYPES = {
    "9": { "name": "商务座", "short": "swz" },
    "P": { "name": "特等座", "short": "tz" },
    "M": { "name": "一等座", "short": "zy" },
    "D": { "name": "优选一等座", "short": "zy" },
    "O": { "name": "二等座", "short": "ze" },
    "S": { "name": "二等包座", "short": "ze" },
    "6": { "name": "高级软卧", "short": "gr" },
    "A": { "name": "高级动卧", "short": "gr" },
    "4": { "name": "软卧", "short": "rw" },
    "I": { "name": "一等卧", "short": "rw" },
    "F": { "name": "动卧", "short": "rw" },
    "3": { "name": "硬卧", "short": "yw" },
    "J": { "name": "二等卧", "short": "yw" },
    "2": { "name": "软座", "short": "rz" },
    "1": { "name": "硬座", "short": "yz" },
    "W": { "name": "无座", "short": "wz" },
    "WZ": { "name": "无座", "short": "wz" },
    "H": { "name": "其他", "short": "qt" }
};

// 12306 票数据字段顺序
const TICKET_DATA_KEYS = [
    "secret_Sstr", "button_text_info", "train_no", "station_train_code",
    "start_station_telecode", "end_station_telecode", "from_station_telecode",
    "to_station_telecode", "start_time", "arrive_time", "lishi", "canWebBuy",
    "yp_info", "start_train_date", "train_seat_feature", "location_code",
    "from_station_no", "to_station_no", "is_support_card", "controlled_train_flag",
    "gg_num", "gr_num", "qt_num", "rw_num", "rz_num", "tz_num", "wz_num",
    "yb_num", "yw_num", "yz_num", "ze_num", "zy_num", "swz_num", "srrb_num",
    "yp_ex", "seat_types", "exchange_train_flag", "houbu_train_flag",
    "houbu_seat_limit", "yp_info_new", "40", "41", "42", "43", "44", "45",
    "dw_flag", "47", "stopcheckTime", "country_flag", "local_arrive_time",
    "local_start_time", "52", "bed_level_info", "seat_discount_info", "sale_time", "56"
];

// 缓存配置
const SKILL_DIR = new URL('.', import.meta.url).pathname;
const CACHE_DIR = SKILL_DIR;
const STATIONS_CACHE_FILE = `${CACHE_DIR}stations.json`;
const LCQUERY_PATH_FILE = `${CACHE_DIR}lcquery_path`;
const CACHE_TTL = 86400000; // 1天 = 86400秒 * 1000ms

// 缓存状态
let cachedStations = null;
let cachedLCQueryPath = null;

import fs from 'fs';

// ============ 工具函数 ============

function formatCookies(cookies) {
    return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

function parseSetCookie(header) {
    if (!header) return {};
    const result = {};
    for (const cookie of header.split(',')) {
        const [pair] = cookie.split(';');
        const [name, ...rest] = pair.trim().split('=');
        result[name] = rest.join('=');
    }
    return result;
}

function getShanghaiDate() {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const shanghai = new Date(utc + 8 * 3600000);
    const y = shanghai.getFullYear();
    const m = String(shanghai.getMonth() + 1).padStart(2, '0');
    const d = String(shanghai.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// 缓存检查
function isCacheValid(filePath) {
    try {
        const stats = fs.statSync(filePath);
        return (Date.now() - stats.mtimeMs) < CACHE_TTL;
    } catch {
        return false;
    }
}

// 读取缓存
function readCache(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

// 写入缓存
function writeCache(filePath, data) {
    try {
        fs.writeFileSync(filePath, data, 'utf8');
    } catch (err) {
        console.error(`警告: 写入缓存失败: ${err.message}`);
    }
}

// 获取车站缓存
async function getCachedStations() {
    if (cachedStations) return cachedStations;
    
    if (isCacheValid(STATIONS_CACHE_FILE)) {
        try {
            const data = readCache(STATIONS_CACHE_FILE);
            cachedStations = JSON.parse(data);
            return cachedStations;
        } catch {
            // 缓存损坏，重新获取
        }
    }
    
    // 从 API 获取
    const stations = await fetchStations();
    writeCache(STATIONS_CACHE_FILE, JSON.stringify(stations, null, 2));
    cachedStations = stations;
    return stations;
}

// 获取 lcQuery 路径缓存
async function getCachedLCQueryPath() {
    if (cachedLCQueryPath) return cachedLCQueryPath;
    
    if (isCacheValid(LCQUERY_PATH_FILE)) {
        try {
            cachedLCQueryPath = readCache(LCQUERY_PATH_FILE);
            return cachedLCQueryPath;
        } catch {
            // 缓存损坏，重新获取
        }
    }
    
    // 从 API 获取
    const path = await fetchLCQueryPath();
    writeCache(LCQUERY_PATH_FILE, path);
    cachedLCQueryPath = path;
    return path;
}

// 刷新缓存
async function refreshCache() {
    const stations = await fetchStations();
    writeCache(STATIONS_CACHE_FILE, JSON.stringify(stations, null, 2));
    cachedStations = stations;
    
    const lcPath = await fetchLCQueryPath();
    writeCache(LCQUERY_PATH_FILE, lcPath);
    cachedLCQueryPath = lcPath;
    
    return {
        stations: `已更新 ${Object.keys(stations).length} 个车站`,
        lcquery: `已更新 lcQuery 路径`
    };
}

// 解析车站编码（支持中文站名）
function parseStationCode(name, stations) {
    // 如果是 3 位字母，直接作为编码
    if (/^[A-Z]{3}$/.test(name)) return name;
    
    // 尝试从车站列表中查找
    for (const [code, s] of Object.entries(stations)) {
        if (s.station_name === name || s.station_name.replace(/ /g, '') === name) {
            return code;
        }
    }
    return null;
}

// 解析座位信息
function parseSeats(ticketData) {
    const seats = {};
    
    // 使用 yp_info_new (索引 39) 解析座位价格
    const ypInfoNew = ticketData.yp_info_new || '';
    const PRICE_STR_LENGTH = 10;
    
    if (ypInfoNew.length >= PRICE_STR_LENGTH) {
        for (let i = 0; i < ypInfoNew.length; i += PRICE_STR_LENGTH) {
            const priceStr = ypInfoNew.substring(i, i + PRICE_STR_LENGTH);
            if (priceStr.length < PRICE_STR_LENGTH) continue;
            
            // 座位类型代码
            let seatTypeCode;
            const datePart = parseInt(priceStr.substring(6, 10));
            if (datePart >= 3000) {
                seatTypeCode = 'W'; // 无座
            } else if (SEAT_TYPES[priceStr[0]]) {
                seatTypeCode = priceStr[0];
            } else {
                seatTypeCode = 'H'; // 其他
            }
            
            const seatType = SEAT_TYPES[seatTypeCode];
            if (!seatType) continue;
            
            // 价格 (单位是分，需要除以 10)
            const price = parseInt(priceStr.substring(1, 6)) / 10;
            
            // 座位数量
            const num = ticketData[`${seatType.short}_num`] || '';
            const numInt = parseInt(num);
            
            seats[seatType.name] = {
                num: numInt > 0 ? `${numInt}张` : '无票',
                price: `${price}元`
            };
        }
    }
    
    // 如果 yp_info_new 解析失败，使用原始座位数量字段
    if (Object.keys(seats).length === 0) {
        const seatFields = ['swz_num', 'tz_num', 'zy_num', 'ze_num', 'rw_num', 'yw_num', 'rz_num', 'yz_num', 'wz_num'];
        const seatNames = ['商务座', '特等座', '一等座', '二等座', '软卧', '硬卧', '软座', '硬座', '无座'];
        
        for (let i = 0; i < seatFields.length; i++) {
            const num = ticketData[seatFields[i]];
            if (num !== undefined && num !== '') {
                const numInt = parseInt(num);
                seats[seatNames[i]] = {
                    num: numInt > 0 ? `${numInt}张` : '无票',
                    price: '查询中'
                };
            }
        }
    }
    
    return seats;
}

// 过滤车次
function filterTrains(tickets, flags) {
    if (!flags) return tickets;
    return tickets.filter(t => {
        const code = t.station_train_code;
        if (flags.includes('G') && code.startsWith('G')) return true;
        if (flags.includes('D') && code.startsWith('D')) return true;
        if (flags.includes('Z') && code.startsWith('Z')) return true;
        if (flags.includes('T') && code.startsWith('T')) return true;
        if (flags.includes('K') && code.startsWith('K')) return true;
        if (flags.includes('O') && code.startsWith('O')) return true;
        if (flags.includes('F')) return true; // 复兴号
        if (flags.includes('S')) return true; // 智能动车组
        return false;
    });
}

// 时间范围过滤
function filterByTime(tickets, earliest, latest) {
    if (earliest === undefined && latest === undefined) return tickets;
    return tickets.filter(t => {
        const hour = parseInt(t.start_time.split(':')[0]);
        return (!earliest || hour >= earliest) && (!latest || hour <= latest);
    });
}

// 排序
function sortTickets(tickets, flag, reverse) {
    if (!flag) return tickets;
    const sorted = [...tickets].sort((a, b) => {
        switch (flag) {
            case 'startTime':
                return a.start_time.localeCompare(b.start_time);
            case 'arriveTime':
                return a.arrive_time.localeCompare(b.arrive_time);
            case 'duration':
                return a.lishi.localeCompare(b.lishi);
            default:
                return 0;
        }
    });
    return reverse ? sorted.reverse() : sorted;
}

// 限制数量
function limitResults(tickets, limit) {
    return limit ? tickets.slice(0, limit) : tickets;
}

// ============ HTTP 请求 ============

async function request12306(url, params = {}, headers = {}) {
    try {
        const qs = Object.entries(params)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join('&');
        const sep = url.includes('?') ? '&' : '?';
        const res = await fetch(url + sep + qs, {
            headers: {
                'User-Agent': UA,
                ...headers
            }
        });
        if (!res.ok) return null;
        return await res.text();
    } catch {
        return null;
    }
}

async function fetchCookie() {
    try {
        const res = await fetch(`${API_BASE}/otn/leftTicket/init`, {
            headers: { 'User-Agent': UA }
        });
        return parseSetCookie(res.headers.get('set-cookie'));
    } catch {
        return null;
    }
}

// ============ 车站数据 ============

function parseStationData(raw) {
    const result = {};
    const arr = raw.split('|');
    for (let i = 0; i < Math.floor(arr.length / 10); i++) {
        const s = arr.slice(i * 10, i * 10 + 10);
        if (s[2]) {
            result[s[2]] = {
                station_id: s[0],
                station_name: s[1],
                station_code: s[2],
                station_pinyin: s[3],
                station_short: s[4],
                station_index: s[5],
                code: s[6],
                city: s[7],
                r1: s[8],
                r2: s[9]
            };
        }
    }
    return result;
}

async function fetchStations() {
    const html = await request12306(WEB_URL);
    if (!html) throw new Error('获取 12306 页面失败');

    const match = html.match(/<script src="(.+?station_name.+?\.js)"/);
    if (!match) throw new Error('未找到车站数据文件');

    const js = await request12306(new URL(match[1], WEB_URL).href);
    if (!js) throw new Error('获取车站数据失败');

    const raw = js.match(/station_names\s*=\s*'(.+)'/)?.[1];
    if (!raw) throw new Error('解析车站数据失败');

    return parseStationData(raw);
}

// 获取车站（使用缓存）
async function getStations() {
    return getCachedStations();
}

// ============ 余票查询 ============

async function fetchTickets(date, fromCode, toCode, options = {}) {
    const cookies = await fetchCookie();
    if (!cookies) return { error: '获取 cookie 失败' };

    const params = {
        'leftTicketDTO.train_date': date,
        'leftTicketDTO.from_station': fromCode,
        'leftTicketDTO.to_station': toCode,
        purpose_codes: 'ADULT'
    };

    const text = await request12306(
        `${API_BASE}/otn/leftTicket/query`,
        params,
        { Cookie: formatCookies(cookies) }
    );

    if (!text) return { error: '查询余票失败' };

    try {
        const data = JSON.parse(text);
        const tickets = (data.data?.result || []).map(t => {
            const p = t.split('|');
            
            // 解析所有字段
            const ticketData = {};
            for (let i = 0; i < Math.min(p.length, TICKET_DATA_KEYS.length); i++) {
                ticketData[TICKET_DATA_KEYS[i]] = p[i];
            }
            
            // 解析座位信息
            const seats = parseSeats(ticketData);
            
            return {
                status: p[1],
                train_no: p[2],
                station_train_code: p[3],
                start_telecode: p[4],
                arrive_telecode: p[5],
                depart_telecode: p[6],
                arrive_telecode2: p[7],
                start_time: p[8],
                arrive_time: p[9],
                lishi: p[10],
                can_buy: p[11],
                date: p[12],
                tourist_flag: p[13],
                yp_info: p[14],
                yp_ex: p[15],
                seat_types: p[21],
                dw_flag: p[24],
                control_ticket: p[26],
                xtzl: p[27],
                qd_type: p[28],
                seats: seats,  // 解析后的座位信息
                raw_seats: p[30]  // 保留原始座位字符串
            };
        }).filter(Boolean);

        // 过滤匹配的站次
        let filtered = tickets.filter(t => 
            t.depart_telecode === fromCode && t.arrive_telecode2 === toCode
        );

        // 应用筛选
        if (options.flags) filtered = filterTrains(filtered, options.flags);
        if (options.earliest || options.latest) filtered = filterByTime(filtered, options.earliest, options.latest);
        if (options.sort) filtered = sortTickets(filtered, options.sort, options.reverse);
        if (options.limit) filtered = limitResults(filtered, options.limit);

        return {
            tickets: filtered,
            map: data.data?.map || {},
            query: { from: fromCode, to: toCode }
        };
    } catch {
        return { error: '解析余票数据失败' };
    }
}

// ============ 中转票查询 ============

async function fetchLCQueryPath() {
    const html = await request12306(LCQUERY_INIT_URL, {}, {
        'Accept-Language': 'zh-CN,zh;q=0.9,zh-TW;q=0.8,zh-HK;q=0.7,en-US;q=0.6,en;q=0.5'
    });
    if (!html) throw new Error('获取 lcQuery 页面失败');
    const match = html.match(/\s*var\s+lc_search_url\s*=\s*'(.+?)'/);
    if (!match) throw new Error('获取 lcQuery 路径失败');
    return match[1];
}

// 获取 lcQuery 路径（使用缓存）
async function getLCQueryPath() {
    return getCachedLCQueryPath();
}

async function fetchInterlineTickets(date, fromCode, toCode, middleCode = '', options = {}) {
    const cookies = await fetchCookie();
    if (!cookies) return { error: '获取 cookie 失败' };

    const lcPath = await getLCQueryPath();
    const params = {
        train_date: date,
        from_station_telecode: fromCode,
        to_station_telecode: toCode,
        middle_station: middleCode,
        result_index: '0',
        can_query: 'Y',
        isShowWZ: options.showWZ ? 'Y' : 'N',
        purpose_codes: '00',
        channel: 'E'
    };

    const text = await request12306(
        `${API_BASE}${lcPath}`,
        params,
        { Cookie: formatCookies(cookies) }
    );

    if (!text) return { error: '查询中转票失败' };

    try {
        const data = JSON.parse(text);
        if (typeof data?.data === 'string') {
            return { error: data.errorMsg || '未找到中转方案' };
        }
        
        let interlines = data?.data?.middleList || [];
        
        // 应用筛选
        if (options.flags) {
            interlines = interlines.filter(i => {
                return i.fullList.some(ticket => {
                    const code = ticket.station_train_code || '';
                    if (options.flags.includes('G') && code.startsWith('G')) return true;
                    if (options.flags.includes('D') && code.startsWith('D')) return true;
                    if (options.flags.includes('Z') && code.startsWith('Z')) return true;
                    if (options.flags.includes('T') && code.startsWith('T')) return true;
                    if (options.flags.includes('K') && code.startsWith('K')) return true;
                    return false;
                });
            });
        }
        
        if (options.limit) interlines = interlines.slice(0, options.limit);

        return {
            interlines,
            can_query: data?.data?.can_query,
            result_index: data?.data?.result_index
        };
    } catch {
        return { error: '解析中转票数据失败' };
    }
}

// ============ 经停站查询 ============

async function searchTrainNo(trainCode, date) {
    const text = await request12306(
        `${SEARCH_API_BASE}/search/v1/train/search`,
        { keyword: trainCode, date: date.replace(/-/g, '') }
    );
    if (!text) return null;
    try {
        const data = JSON.parse(text);
        return data.data?.[0] || null;
    } catch {
        return null;
    }
}

async function fetchTrainRoute(trainNo, date) {
    const searchResult = await searchTrainNo(trainNo, date);
    if (!searchResult) {
        return { error: '未找到车次信息，请检查车次编号' };
    }

    const cookies = await fetchCookie();
    if (!cookies) return { error: '获取 cookie 失败' };

    const params = {
        'leftTicketDTO.train_no': searchResult.train_no,
        'leftTicketDTO.train_date': date,
        rand_code: ''
    };

    const text = await request12306(
        `${API_BASE}/otn/queryTrainInfo/query`,
        params,
        { Cookie: formatCookies(cookies) }
    );

    if (!text) return { error: '查询经停站失败' };

    try {
        const data = JSON.parse(text);
        return {
            stations: data?.data?.data || [],
            httpstatus: data?.httpstatus
        };
    } catch {
        return { error: '解析经停站数据失败' };
    }
}

// ============ 车站搜索 ============

async function searchStations(keyword) {
    const allStations = await getStations();
    const results = [];
    for (const [code, s] of Object.entries(allStations)) {
        if (s.station_name.includes(keyword) || s.city.includes(keyword) || s.station_pinyin.includes(keyword.toLowerCase())) {
            results.push({ ...s, station_code: code });
        }
    }
    return results.slice(0, 20);
}

// ============ CLI 入口 ============

async function main() {
    const [cmd, ...args] = process.argv.slice(2);

    try {
        switch (cmd) {
            case 'date':
                console.log(getShanghaiDate());
                break;

            case 'stations': {
                const all = await getStations();
                const city = args[0];
                if (city) {
                    const filtered = {};
                    for (const [code, s] of Object.entries(all)) {
                        if (s.city === city) filtered[code] = s;
                    }
                    console.log(JSON.stringify(filtered, null, 2));
                } else {
                    console.log(JSON.stringify(all, null, 2));
                }
                break;
            }

            case 'refresh-cache':
                console.log(JSON.stringify(await refreshCache(), null, 2));
                break;

            case 'search': {
                const kw = args[0];
                if (!kw) {
                    console.error('用法: node 12306.mjs search <关键字>');
                    process.exit(1);
                }
                console.log(JSON.stringify(await searchStations(kw), null, 2));
                break;
            }

            case 'tickets': {
                const [date, from, to] = args;
                if (!date || !from || !to) {
                    console.error('用法: node 12306.mjs tickets <日期> <出发站> <到达站>');
                    process.exit(1);
                }
                
                // 解析车站编码
                const stations = await getStations();
                const fromCode = parseStationCode(from, stations) || from;
                const toCode = parseStationCode(to, stations) || to;
                
                if (!fromCode || !toCode) {
                    console.error('错误: 未找到车站编码');
                    process.exit(1);
                }
                
                // 解析选项
                const options = {};
                const opts = args.slice(3); // 跳过 date, from, to
                opts.forEach(opt => {
                    if (opt.startsWith('--flags=')) options.flags = opt.split('=')[1];
                    if (opt.startsWith('--earliest=')) options.earliest = parseInt(opt.split('=')[1]);
                    if (opt.startsWith('--latest=')) options.latest = parseInt(opt.split('=')[1]);
                    if (opt.startsWith('--sort=')) options.sort = opt.split('=')[1];
                    if (opt.startsWith('--limit=')) options.limit = parseInt(opt.split('=')[1]);
                    if (opt === '--reverse') options.reverse = true;
                });
                
                console.log(JSON.stringify(await fetchTickets(date, fromCode, toCode, options), null, 2));
                break;
            }

            case 'interline': {
                const [date, from, to, middle] = args;
                if (!date || !from || !to) {
                    console.error('用法: node 12306.mjs interline <日期> <出发站> <到达站> [中转站]');
                    process.exit(1);
                }
                
                const stations = await getStations();
                const fromCode = parseStationCode(from, stations) || from;
                const toCode = parseStationCode(to, stations) || to;
                const middleCode = middle ? parseStationCode(middle, stations) || middle : '';
                
                if (!fromCode || !toCode) {
                    console.error('错误: 未找到车站编码');
                    process.exit(1);
                }
                
                const options = {};
                const optIndex = args.indexOf('--');
                if (optIndex !== -1) {
                    const opts = args.slice(optIndex + 1);
                    opts.forEach(opt => {
                        if (opt.startsWith('--flags=')) options.flags = opt.split('=')[1];
                        if (opt.startsWith('--limit=')) options.limit = parseInt(opt.split('=')[1]);
                        if (opt === '--show-wz') options.showWZ = true;
                    });
                }
                
                console.log(JSON.stringify(await fetchInterlineTickets(date, fromCode, toCode, middleCode, options), null, 2));
                break;
            }

            case 'route': {
                const [trainNo, date] = args;
                if (!trainNo || !date) {
                    console.error('用法: node 12306.mjs route <车次编号> <日期>');
                    process.exit(1);
                }
                console.log(JSON.stringify(await fetchTrainRoute(trainNo, date), null, 2));
                break;
            }

            default:
                console.error('用法: node 12306.mjs <命令> [参数]');
                console.error('命令:');
                console.error('  date                                   获取当前日期');
                console.error('  stations [城市]                         获取车站列表');
                console.error('  search <关键字>                         搜索车站');
                console.error('  tickets <日期> <出发站> <到达站>        查询余票');
                console.error('  interline <日期> <出发站> <到达站> [中转站]  查询中转票');
                console.error('  route <车次> <日期>                        查询经停站');
                console.error('  refresh-cache                          刷新缓存');
                console.error('选项:');
                console.error('  --flags=G  车次筛选 (G/D/Z/T/K)');
                console.error('  --earliest=8  最早出发时间');
                console.error('  --latest=18  最迟出发时间');
                console.error('  --sort=startTime  排序方式');
                console.error('  --limit=10  结果数量限制');
                console.error('  --reverse  反向排序');
                process.exit(1);
        }
    } catch (err) {
        console.error('错误:', err.message);
        process.exit(1);
    }
}

main();