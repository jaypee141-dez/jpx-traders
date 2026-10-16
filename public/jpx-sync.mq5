//+------------------------------------------------------------------+
//| JPX Sync - sends closed MT5 positions (and open ones, for       |
//| strategy leaders) to your JPX Traders journal                    |
//| Setup: Tools > Options > Expert Advisors > allow WebRequest for   |
//| your JPX server origin (e.g. https://your-domain.com).            |
//+------------------------------------------------------------------+
#property copyright "JPX Traders"
#property version   "1.00"
#property strict

input string ServerUrl   = "https://your-domain.com/api/ingest"; // JPX ingest URL (from Brokers page)
input string ApiKey      = "";                                    // API key generated for this account
input int    HistoryDays = 90;                                    // History uploaded on first run
input int    BatchSize   = 100;                                   // Positions per request

bool   g_pending = false;
datetime g_lastFull = 0;

//--- helpers ----------------------------------------------------------
string JsonNum(const double v, const int digits = 8) { return DoubleToString(v, digits); }

long ToUtc(const datetime serverTime)
  {
   return (long)serverTime + (long)(TimeGMT() - TimeTradeServer());
  }

bool Post(const string url, const string body, string &response, int &status)
  {
   char data[], result[];
   string resHeaders;
   string headers = "Content-Type: application/json\r\nX-API-Key: " + ApiKey + "\r\n";
   StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(data, ArraySize(data) - 1); // drop trailing NUL
   ResetLastError();
   status = WebRequest("POST", url, headers, 15000, data, result, resHeaders);
   if(status == -1)
     {
      PrintFormat("JPX: WebRequest failed (error %d). If 4014, add the server origin under Tools > Options > Expert Advisors.", GetLastError());
      return false;
     }
   response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   return (status == 200);
  }

bool Ping()
  {
   char data[], result[];
   string resHeaders, headers = "X-API-Key: " + ApiKey + "\r\n";
   ResetLastError();
   int st = WebRequest("GET", ServerUrl + "/ping", headers, 10000, data, result, resHeaders);
   if(st == -1) { PrintFormat("JPX: cannot reach server (error %d)", GetLastError()); return false; }
   PrintFormat("JPX: ping status %d %s", st, CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8));
   return st == 200;
  }

//--- builds the JSON object for one fully closed position; returns false if still open / not found
bool BuildPosition(const ulong posId, string &json)
  {
   if(PositionSelectByTicket(posId)) return false; // still open
   if(!HistorySelectByPosition(posId)) return false;
   int n = HistoryDealsTotal();
   double inVol = 0, inPx = 0, outVol = 0, outPx = 0, profit = 0, comm = 0, swap = 0;
   datetime openT = 0, closeT = 0;
   bool isLong = true, haveIn = false, haveOut = false;
   string symbol = "";
   for(int i = 0; i < n; i++)
     {
      ulong t = HistoryDealGetTicket(i);
      long type = HistoryDealGetInteger(t, DEAL_TYPE);
      if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;
      long entry = HistoryDealGetInteger(t, DEAL_ENTRY);
      double vol = HistoryDealGetDouble(t, DEAL_VOLUME), px = HistoryDealGetDouble(t, DEAL_PRICE);
      datetime tm = (datetime)HistoryDealGetInteger(t, DEAL_TIME);
      profit += HistoryDealGetDouble(t, DEAL_PROFIT);
      comm   += HistoryDealGetDouble(t, DEAL_COMMISSION);
      swap   += HistoryDealGetDouble(t, DEAL_SWAP);
      symbol  = HistoryDealGetString(t, DEAL_SYMBOL);
      if(entry == DEAL_ENTRY_IN)
        {
         if(!haveIn) { openT = tm; isLong = (type == DEAL_TYPE_BUY); haveIn = true; }
         inVol += vol; inPx += px * vol;
        }
      else if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY || entry == DEAL_ENTRY_INOUT)
        {
         haveOut = true; closeT = tm; outVol += vol; outPx += px * vol;
        }
     }
   if(!haveIn || !haveOut || inVol <= 0 || symbol == "") return false;
   json = StringFormat("{\"external_id\":\"%I64u\",\"symbol\":\"%s\",\"side\":\"%s\",\"volume\":%s,\"entry_price\":%s,\"exit_price\":%s,\"open_time\":%I64d,\"close_time\":%I64d,\"profit\":%s,\"commission\":%s,\"swap\":%s}",
                       posId, symbol, isLong ? "buy" : "sell", JsonNum(inVol, 2), JsonNum(inPx / inVol), JsonNum(outVol > 0 ? outPx / outVol : 0),
                       ToUtc(openT), ToUtc(closeT), JsonNum(profit, 2), JsonNum(comm, 2), JsonNum(swap, 2));
   return true;
  }

void SyncFrom(const datetime from)
  {
   if(!HistorySelect(from, TimeCurrent() + 86400)) { Print("JPX: HistorySelect failed"); return; }
   int total = HistoryDealsTotal();
   ulong ids[];
   for(int i = 0; i < total; i++)
     {
      ulong t = HistoryDealGetTicket(i);
      long entry = HistoryDealGetInteger(t, DEAL_ENTRY);
      long type = HistoryDealGetInteger(t, DEAL_TYPE);
      if((type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) || entry == DEAL_ENTRY_IN) continue;
      ulong pid = (ulong)HistoryDealGetInteger(t, DEAL_POSITION_ID);
      bool dup = false;
      for(int k = ArraySize(ids) - 1; k >= 0 && !dup; k--) dup = (ids[k] == pid);
      if(!dup) { int s = ArraySize(ids); ArrayResize(ids, s + 1); ids[s] = pid; }
     }
   string batch = ""; int count = 0, sent = 0;
   for(int i = 0; i < ArraySize(ids); i++)
     {
      string one;
      if(!BuildPosition(ids[i], one)) continue;
      batch += (count ? "," : "") + one; count++;
      if(count >= BatchSize) { if(!Flush(batch)) return; sent += count; batch = ""; count = 0; }
     }
   if(count > 0) { if(!Flush(batch)) return; sent += count; }
   PrintFormat("JPX: synced %d closed position(s)", sent);
  }

bool Flush(const string batch)
  {
   string resp; int st;
   bool ok = Post(ServerUrl, "{\"trades\":[" + batch + "]}", resp, st);
   if(!ok) PrintFormat("JPX: server replied %d: %s", st, resp);
   return ok;
  }

//--- publishes currently open positions (used by strategy leaders for live copy trading)
void SendOpenPositions()
  {
   int n = PositionsTotal();
   if(n <= 0) return;
   string batch = ""; int count = 0;
   for(int i = 0; i < n; i++)
     {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      long type = PositionGetInteger(POSITION_TYPE);
      string one = StringFormat("{\"external_id\":\"%I64u\",\"symbol\":\"%s\",\"side\":\"%s\",\"volume\":%s,\"entry_price\":%s,\"stop_loss\":%s,\"take_profit\":%s,\"open_time\":%I64d}",
                                (ulong)PositionGetInteger(POSITION_IDENTIFIER), PositionGetString(POSITION_SYMBOL), type == POSITION_TYPE_BUY ? "buy" : "sell",
                                JsonNum(PositionGetDouble(POSITION_VOLUME), 2), JsonNum(PositionGetDouble(POSITION_PRICE_OPEN)), JsonNum(PositionGetDouble(POSITION_SL)),
                                JsonNum(PositionGetDouble(POSITION_TP)), ToUtc((datetime)PositionGetInteger(POSITION_TIME)));
      batch += (count ? "," : "") + one; count++;
     }
   string resp; int st;
   if(!Post(ServerUrl, "{\"open_positions\":[" + batch + "]}", resp, st)) PrintFormat("JPX: open positions upload failed (%d): %s", st, resp);
  }

//--- events -------------------------------------------------------------
int OnInit()
  {
   if(StringLen(ApiKey) < 10) { Print("JPX: set the ApiKey input"); return INIT_PARAMETERS_INCORRECT; }
   Ping();
   SyncFrom(TimeCurrent() - (datetime)HistoryDays * 86400);
   SendOpenPositions();
   g_lastFull = TimeCurrent();
   EventSetTimer(30);
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason) { EventKillTimer(); }

void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &req, const MqlTradeResult &res)
  {
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD) g_pending = true;
  }

void OnTimer()
  {
   if(g_pending) { g_pending = false; SendOpenPositions(); SyncFrom(TimeCurrent() - 3 * 86400); }
  }
//+------------------------------------------------------------------+
