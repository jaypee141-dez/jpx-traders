//+------------------------------------------------------------------+
//| JPX Copy - opens and closes trades copied from JPX Traders leaders|
//| IMPORTANT: starts in PRACTICE mode (ExecuteTrades=false): it only |
//| logs what it would do. Set ExecuteTrades=true to place real       |
//| orders. Test on a demo account first. Trading involves risk.      |
//| Setup: allow WebRequest for your JPX server origin               |
//| (Tools > Options > Expert Advisors) and use the API key of the    |
//| account you chose as the copy destination.                        |
//+------------------------------------------------------------------+
#property copyright "JPX Traders"
#property version   "1.00"
#property strict
#include <Trade\Trade.mqh>

input string ServerUrl     = "https://your-domain.com/api/copy"; // JPX copy API base URL
input string ApiKey        = "";                                  // API key of the destination account
input bool   ExecuteTrades = false;                               // false = practice mode (log only)
input string SymbolSuffix  = "";                                  // broker symbol suffix, e.g. ".m"
input int    Slippage      = 20;                                  // max slippage in points
input long   MagicNumber   = 777001;                              // magic number for copied trades
input int    PollSeconds   = 2;                                   // how often to ask the server

CTrade g_trade;
long   g_seen[];

bool Seen(const long id)
  {
   for(int i = 0; i < ArraySize(g_seen); i++) if(g_seen[i] == id) return true;
   return false;
  }
void MarkSeen(const long id) { int n = ArraySize(g_seen); ArrayResize(g_seen, n + 1); g_seen[n] = id; }

string JStr(const string obj, const string key)
  {
   string k = "\"" + key + "\":";
   int p = StringFind(obj, k); if(p < 0) return "";
   p += StringLen(k);
   if(StringGetCharacter(obj, p) == '"')
     { int e = StringFind(obj, "\"", p + 1); return StringSubstr(obj, p + 1, e - p - 1); }
   int e1 = StringFind(obj, ",", p), e2 = StringFind(obj, "}", p);
   int e = (e1 < 0) ? e2 : (e2 < 0 ? e1 : MathMin(e1, e2));
   string v = StringSubstr(obj, p, e - p); StringTrimLeft(v); StringTrimRight(v);
   return (v == "null") ? "" : v;
  }

bool Http(const string method, const string url, const string body, string &resp)
  {
   char data[], result[]; string rh;
   string headers = "Content-Type: application/json\r\nX-API-Key: " + ApiKey + "\r\n";
   if(StringLen(body) > 0) { StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8); ArrayResize(data, ArraySize(data) - 1); }
   ResetLastError();
   int st = WebRequest(method, url, headers, 10000, data, result, rh);
   if(st == -1) { PrintFormat("JPX Copy: WebRequest error %d (4014 = allow the URL in Tools > Options > Expert Advisors)", GetLastError()); return false; }
   resp = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   return st == 200;
  }

void Ack(const long mirrorId, const string action, const bool ok, const string ticket)
  {
   string body = StringFormat("{\"mirror_id\":%I64d,\"action\":\"%s\",\"ok\":%s,\"ticket\":\"%s\"}", mirrorId, action, ok ? "true" : "false", ticket), r;
   Http("POST", ServerUrl + "/ack", body, r);
  }

double NormVolume(const string sym, double v)
  {
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP), mn = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN), mx = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   if(step <= 0) step = 0.01;
   v = MathFloor(v / step + 1e-9) * step;
   return MathMax(mn, MathMin(mx, v));
  }

void DoOpen(const long mirrorId, const string obj)
  {
   string sym = JStr(obj, "symbol") + SymbolSuffix, side = JStr(obj, "side");
   double vol = StringToDouble(JStr(obj, "volume")), sl = StringToDouble(JStr(obj, "stop_loss")), tp = StringToDouble(JStr(obj, "take_profit"));
   if(!SymbolSelect(sym, true)) { PrintFormat("JPX Copy: symbol %s not available at this broker", sym); return; }
   vol = NormVolume(sym, vol);
   if(!ExecuteTrades) { if(!Seen(mirrorId)) { PrintFormat("JPX Copy [practice]: would %s %.2f %s", side == "long" ? "BUY" : "SELL", vol, sym); MarkSeen(mirrorId); } return; }
   g_trade.SetExpertMagicNumber(MagicNumber); g_trade.SetDeviationInPoints(Slippage);
   bool ok = (side == "long") ? g_trade.Buy(vol, sym, 0, sl, tp, "JPX copy") : g_trade.Sell(vol, sym, 0, sl, tp, "JPX copy");
   if(!ok) { PrintFormat("JPX Copy: open failed (%d) %s", g_trade.ResultRetcode(), g_trade.ResultComment()); return; }
   ulong deal = g_trade.ResultDeal(); ulong posId = 0;
   if(deal > 0 && HistoryDealSelect(deal)) posId = (ulong)HistoryDealGetInteger(deal, DEAL_POSITION_ID);
   if(posId == 0) posId = g_trade.ResultOrder();
   Ack(mirrorId, "open", true, StringFormat("%I64u", posId));
   PrintFormat("JPX Copy: opened %s %.2f %s (position %I64u)", side, vol, sym, posId);
  }

void DoClose(const long mirrorId, const string obj)
  {
   string tk = JStr(obj, "ticket");
   if(!ExecuteTrades) { if(!Seen(-mirrorId)) { PrintFormat("JPX Copy [practice]: would close position %s", tk); MarkSeen(-mirrorId); } return; }
   ulong pos = (ulong)StringToInteger(tk);
   if(pos == 0 || !PositionSelectByTicket(pos)) { Ack(mirrorId, "close", true, tk); return; } // already closed
   g_trade.SetExpertMagicNumber(MagicNumber); g_trade.SetDeviationInPoints(Slippage);
   if(g_trade.PositionClose(pos)) { Ack(mirrorId, "close", true, tk); PrintFormat("JPX Copy: closed position %I64u", pos); }
   else PrintFormat("JPX Copy: close failed (%d) %s", g_trade.ResultRetcode(), g_trade.ResultComment());
  }

int OnInit()
  {
   if(StringLen(ApiKey) < 10) { Print("JPX Copy: set the ApiKey input"); return INIT_PARAMETERS_INCORRECT; }
   PrintFormat("JPX Copy started in %s mode", ExecuteTrades ? "LIVE EXECUTION" : "practice");
   EventSetTimer(MathMax(1, PollSeconds));
   return INIT_SUCCEEDED;
  }
void OnDeinit(const int reason) { EventKillTimer(); }

void OnTimer()
  {
   string resp;
   if(!Http("GET", ServerUrl + "/pending", "", resp)) return;
   int a = StringFind(resp, "\"actions\":["); if(a < 0) return;
   int pos = a;
   while(true)
     {
      int s = StringFind(resp, "{", pos + 1); if(s < 0) break;
      int e = StringFind(resp, "}", s); if(e < 0) break;
      string obj = StringSubstr(resp, s, e - s + 1); pos = e;
      long id = StringToInteger(JStr(obj, "mirror_id"));
      string act = JStr(obj, "action");
      if(act == "open") DoOpen(id, obj); else if(act == "close") DoClose(id, obj);
     }
  }
