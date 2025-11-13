"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var node_cache_1 = require("@cacheable/node-cache");
var readline = require("readline");
var baileys_1 = require("@whiskeysockets/baileys");
var pino_1 = require("pino");
var ts_qrcode_terminal_1 = require("ts-qrcode-terminal");
var logger = (0, pino_1.default)({ timestamp: function () { return ",\"time\":\"".concat(new Date().toJSON(), "\""); } }, pino_1.default.destination('./wa-logs.txt'));
logger.level = 'info';
var msgRetryCounterCache = new node_cache_1.default();
var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
var question = function (text) { return new Promise(function (resolve) { return rl.question(text, resolve); }); };
var usePairingCode = process.argv.includes('--use-pairing-code');
var startSock = function () { return __awaiter(void 0, void 0, void 0, function () {
    var _a, state, saveCreds, _b, version, isLatest, sock, phoneNumber, code;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0: return [4 /*yield*/, (0, baileys_1.useMultiFileAuthState)('baileys_auth_info')];
            case 1:
                _a = _c.sent(), state = _a.state, saveCreds = _a.saveCreds;
                return [4 /*yield*/, (0, baileys_1.fetchLatestBaileysVersion)()];
            case 2:
                _b = _c.sent(), version = _b.version, isLatest = _b.isLatest;
                console.log("using WA v".concat(version.join('.'), ", isLatest: ").concat(isLatest));
                sock = (0, baileys_1.default)({
                    version: version,
                    logger: logger,
                    printQRInTerminal: !usePairingCode,
                    auth: {
                        creds: state.creds,
                        keys: (0, baileys_1.makeCacheableSignalKeyStore)(state.keys, logger),
                    },
                    msgRetryCounterCache: msgRetryCounterCache,
                });
                if (!(usePairingCode && !sock.authState.creds.registered)) return [3 /*break*/, 5];
                return [4 /*yield*/, question('Please enter your phone number (with country code, e.g. 351XXXXXXXXX):\n')];
            case 3:
                phoneNumber = _c.sent();
                return [4 /*yield*/, sock.requestPairingCode(phoneNumber)];
            case 4:
                code = _c.sent();
                console.log("Pairing code: ".concat(code));
                _c.label = 5;
            case 5:
                // --- CORE: REPLY TO "!dXX" ---
                sock.ev.process(function (events) { return __awaiter(void 0, void 0, void 0, function () {
                    var update, connection, lastDisconnect, qr, upsert, _i, _a, msg, text, statusMatch, statusMatch1, match, sides, roll;
                    var _b, _c, _d, _e, _f;
                    return __generator(this, function (_g) {
                        switch (_g.label) {
                            case 0:
                                if (events['connection.update']) {
                                    update = events['connection.update'];
                                    connection = update.connection, lastDisconnect = update.lastDisconnect, qr = update.qr;
                                    if (qr && !usePairingCode) {
                                        console.log('Scan this QR with WhatsApp:');
                                        (0, ts_qrcode_terminal_1.generate)(qr, {
                                            small: true,
                                            qrErrorCorrectLevel: 1, // adjust as needed
                                        });
                                    }
                                    if (connection === 'close') {
                                        if (((_c = (_b = lastDisconnect === null || lastDisconnect === void 0 ? void 0 : lastDisconnect.error) === null || _b === void 0 ? void 0 : _b.output) === null || _c === void 0 ? void 0 : _c.statusCode) !== baileys_1.DisconnectReason.loggedOut) {
                                            startSock();
                                        }
                                        else {
                                            console.log('Connection closed. You are logged out.');
                                        }
                                    }
                                    if (connection === 'open') {
                                        console.log('✅ WhatsApp connected and ready!');
                                    }
                                }
                                if (!events['creds.update']) return [3 /*break*/, 2];
                                return [4 /*yield*/, saveCreds()];
                            case 1:
                                _g.sent();
                                _g.label = 2;
                            case 2:
                                if (!events['messages.upsert']) return [3 /*break*/, 10];
                                upsert = events['messages.upsert'];
                                if (!(upsert.type === 'notify')) return [3 /*break*/, 10];
                                _i = 0, _a = upsert.messages;
                                _g.label = 3;
                            case 3:
                                if (!(_i < _a.length)) return [3 /*break*/, 10];
                                msg = _a[_i];
                                // ignore newsletters, system messages, and own messages
                                if (!msg.message || msg.key.fromMe || (0, baileys_1.isJidNewsletter)(msg.key.remoteJid))
                                    return [3 /*break*/, 9];
                                text = ((_d = msg.message) === null || _d === void 0 ? void 0 : _d.conversation) || ((_f = (_e = msg.message) === null || _e === void 0 ? void 0 : _e.extendedTextMessage) === null || _f === void 0 ? void 0 : _f.text);
                                if (!text) return [3 /*break*/, 9];
                                statusMatch = text.trim().toLowerCase().match(/!ping$/);
                                if (!statusMatch) return [3 /*break*/, 5];
                                return [4 /*yield*/, sock.sendMessage(msg.key.remoteJid, { text: "pong! \uD83C\uDFD3" }, { quoted: msg })];
                            case 4:
                                _g.sent();
                                _g.label = 5;
                            case 5:
                                statusMatch1 = text.trim().toLowerCase().match(/!marco$/);
                                if (!statusMatch1) return [3 /*break*/, 7];
                                return [4 /*yield*/, sock.sendMessage(msg.key.remoteJid, { text: "polo... ou seria Paulo? \uD83E\uDDF2\uD83C\uDFA4" }, { quoted: msg })];
                            case 6:
                                _g.sent();
                                _g.label = 7;
                            case 7:
                                match = text.trim().toLowerCase().match(/^!d(\d{1,3})$|^!roll\s+d(\d{1,3})$/);
                                if (!match) return [3 /*break*/, 9];
                                sides = parseInt(match[1] || match[2], 10);
                                if (!(sides >= 2 && sides <= 100)) return [3 /*break*/, 9];
                                roll = Math.floor(Math.random() * sides) + 1;
                                return [4 /*yield*/, sock.sendMessage(msg.key.remoteJid, { text: "\uD83C\uDFB2 You rolled a *".concat(roll, "* on the d").concat(sides, "!") }, { quoted: msg })];
                            case 8:
                                _g.sent();
                                _g.label = 9;
                            case 9:
                                _i++;
                                return [3 /*break*/, 3];
                            case 10: return [2 /*return*/];
                        }
                    });
                }); });
                return [2 /*return*/];
        }
    });
}); };
startSock();
