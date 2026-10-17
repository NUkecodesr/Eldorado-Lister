if not game:IsLoaded() then game.Loaded:Wait() end
do local t0 = os.clock(); while game.PlaceId == 0 and os.clock() - t0 < 60 do task.wait(0.25) end end
if game.PlaceId ~= 109983668079237 then return end

local ZOTAC_PORT  = 47321
local ZOTAC_TOKEN = "PASTE_AGENT_TOKEN"

local Players     = game:GetService("Players")
local HttpService = game:GetService("HttpService")
local RunService  = game:GetService("RunService")
local StarterGui  = game:GetService("StarterGui")
while not Players.LocalPlayer do task.wait(0.1) end
local LP = Players.LocalPlayer
local PG = LP:WaitForChild("PlayerGui")

if _G.ZotacDeliveryStop then pcall(_G.ZotacDeliveryStop) end
local running = true
_G.ZotacDeliveryStop = function() running = false end

local INVITE_TIMEOUT = 150
local RESEND_EVERY   = 25
local ACCEPT_TIMEOUT = 90

local function notify(text)
    pcall(StarterGui.SetCore, StarterGui, "SendNotification", {Title = "Zotac Delivery", Text = text, Duration = 6})
    print("[ZotacDelivery] " .. text)
end

local httpRequest = (syn and syn.request) or (http and http.request) or http_request or request
local BASE = "http://127.0.0.1:" .. ZOTAC_PORT .. "/agent"
local function api(method, path, body)
    if not httpRequest then return nil end
    local ok, res = pcall(httpRequest, {
        Url = BASE .. path, Method = method,
        Headers = {["Content-Type"] = "application/json", ["X-Zotac-Token"] = ZOTAC_TOKEN},
        Body = body and HttpService:JSONEncode(body) or nil,
    })
    if not ok or not res or res.StatusCode ~= 200 then return nil end
    local okD, data = pcall(HttpService.JSONDecode, HttpService, res.Body)
    return okD and data or nil
end
local function log(level, msg)
    print("[ZotacDelivery] " .. msg)
    api("POST", "/log", {level = level, message = LP.Name .. ": " .. msg})
end

local function fire(sig, ...)
    local args = table.pack(...)
    if typeof(firesignal) == "function" then
        if pcall(firesignal, sig, table.unpack(args, 1, args.n)) then return true end
    end
    local ok, cs = pcall(getconnections, sig)
    if not ok or type(cs) ~= "table" or #cs == 0 then return false end
    local any = false
    for _, c in ipairs(cs) do
        local done = pcall(function()
            if c.Fire then c:Fire(table.unpack(args, 1, args.n)) else c.Function(table.unpack(args, 1, args.n)) end
        end)
        any = any or done
    end
    return any
end
local function shown(o)
    while o and o:IsA("GuiObject") do
        if not o.Visible then return false end
        o = o.Parent
    end
    return true
end
local function norm(s) return (string.lower(tostring(s or "")):gsub("[^%w]", "")) end

local function tradeMenu()
    local g = PG:FindFirstChild("TradePlayerList")
    local root = g and g:FindFirstChild("TradePlayerList")
    local secs = root and root:FindFirstChild("Sections")
    local sec = secs and secs:FindFirstChild("Players")
    return sec and sec:FindFirstChild("SearchBox", true), sec and sec:FindFirstChild("List", true)
end
local function findRow(list, name, uid)
    local want = string.lower(name or "")
    for _, r in ipairs(list:GetChildren()) do
        if r:IsA("Frame") then
            local n, id = string.match(r.Name, "^(.+)_(%d+)$")
            if n and ((uid and tonumber(id) == uid) or string.lower(n) == want) then return r end
        end
    end
    return nil
end
local function openTradeMenu()
    local g = PG:FindFirstChild("TradePlayerList")
    if g and g.Enabled and g:FindFirstChild("TradePlayerList") and g.TradePlayerList.Visible then return true end
    local lc = PG:FindFirstChild("LeftCenter")
    local btn = lc and lc:FindFirstChild("TradePlayerList", true)
    if not (btn and btn:IsA("GuiButton")) then return false end
    fire(btn.Activated, nil, 1)
    local t0 = os.clock()
    repeat task.wait(0.1) until (g and g.Enabled and g.TradePlayerList.Visible) or os.clock() - t0 > 3
    return g and g.Enabled and g.TradePlayerList.Visible
end
local function sendTrade(name, uid)
    openTradeMenu()
    local box, list = tradeMenu()
    if not (box and list) then return false, "the game's trade menu is not loaded" end
    -- the name always goes into "Search player here..." on screen (also when the row is already
    -- listed), pasted in one go, so the proof video shows who the trade went to
    box.Text = name
    task.wait(0.3)
    local hooked = fire(box.FocusLost, true, nil)
    local row, t0 = nil, os.clock()
    repeat RunService.Heartbeat:Wait(); row = findRow(list, name, uid) until (row and os.clock() - t0 > 0.5) or os.clock() - t0 > 6
    if not row and not hooked then return false, "trade search box not hooked" end
    row = findRow(list, name, uid) or row   -- the search may have rebuilt the rows: use the live one
    if not row then return false, "buyer @" .. name .. " not found in trade search" end
    local st = row:FindFirstChild("Status2", true) or row:FindFirstChild("Status", true)
    if st and st:IsA("TextLabel") and string.lower(st.Text) == "offline" then return false, "buyer @" .. name .. " is offline" end
    local btn = row:FindFirstChild("Send", true)
    if not (btn and btn:IsA("GuiButton")) then return false, "no Send button" end
    if not fire(btn.Activated, nil, 1) then return false, "Send button not hooked" end
    return true
end

local function tradeRoot()
    local g = PG:FindFirstChild("TradeLiveTrade")
    local root = g and g:FindFirstChild("TradeLiveTrade")
    if g and g.Enabled and root and root.Visible then return root end
    return nil
end
local function tradePartner(root)
    local other = root:FindFirstChild("Other")
    local un = other and other:FindFirstChild("Username")
    return un and string.match(un.Text, "^@?(.-)'s Offer") or nil
end
local function buttonWithText(root, ...)
    local want = {}
    for _, t in ipairs({...}) do want[t] = true end
    for _, d in ipairs(root:GetDescendants()) do
        if d:IsA("GuiButton") and shown(d) then
            local lbl = d:FindFirstChildWhichIsA("TextLabel", true)
            local txt = string.upper((lbl and lbl.Text) or (d:IsA("TextButton") and d.Text) or "")
            if want[txt] then return d end
        end
    end
    return nil
end
local function cancelTrade()
    local root = tradeRoot()
    local b = root and buttonWithText(root, "CANCEL", "DECLINE")
    if b then fire(b.Activated, nil, 1) end
end

local SUFFIX = {K = 1e3, M = 1e6, B = 1e9, T = 1e12, Qa = 1e15}
local function parseMoney(text)
    local num, suf = tostring(text or ""):gsub("<[^>]->", ""):match("([%d%.]+)%s*(%a*)")
    return num and tonumber(num) and tonumber(num) * (SUFFIX[suf] or 1) or nil
end
local function yourItems(root)
    local yours = root:FindFirstChild("Your")
    local sf = yours and yours:FindFirstChild("ScrollingFrame")
    local items = {}
    for _, it in ipairs(sf and sf:GetChildren() or {}) do
        if it:IsA("Frame") and it.Visible and string.find(it.Name, "^Selection_Brainrot") then
            local sp = it:FindFirstChild("Spacer")
            local t = sp and sp:FindFirstChild("Title")
            local c = sp and sp:FindFirstChild("Cash")
            if sp and sp:IsA("GuiButton") then
                local texts = {}
                for _, d in ipairs(it:GetDescendants()) do
                    if d:IsA("TextLabel") and d.Text ~= "" then table.insert(texts, (d.Text:gsub("<[^>]->", ""))) end
                end
                table.insert(items, {frame = it, spacer = sp, title = t and (t.Text:gsub("<[^>]->", "")) or "", all = table.concat(texts, " "), gen = c and parseMoney(c.Text) or nil})
            end
        end
    end
    return items
end
local function isAdded(item)
    local st = item.spacer:FindFirstChildOfClass("UIStroke")
    if not st then return false end
    local c = st.Color
    return c.G > 0.55 and c.R < 0.5 and c.B < 0.6
end

local MUTATION_WORDS = {"gold", "diamond", "rainbow", "lava", "galaxy", "candy", "bloodrot", "cyber", "cursed", "divine", "radioactive", "yinyang", "phantom", "crystal", "eclipse"}
local function matchScore(item, pet)
    local t, n = norm(item.title), norm(pet.name)
    if n == "" or not string.find(t, n, 1, true) then return 0 end
    local m = norm(pet.mutation)
    local plain = (m == "" or m == "none" or m == "normal")
    local all = norm(item.all or item.title)
    if plain then

        for _, w in ipairs(MUTATION_WORDS) do if string.find(all, w, 1, true) then return 1 end end
        return (t == n) and 3 or 2
    end
    if string.find(all, m, 1, true) then return (t == m .. n or t == n .. m) and 3 or 2 end

    return 1
end

local addGap, lastAdd = 0.4, -99
local function addItem(item)
    for _ = 1, 6 do
        if isAdded(item) then return true end
        local w = lastAdd + addGap - os.clock()
        if w > 0 then task.wait(w) end
        fire(item.spacer.Activated, nil, 1)
        local t0 = os.clock()
        repeat RunService.Heartbeat:Wait() until isAdded(item) or os.clock() - t0 > 1.5 or not tradeRoot()
        lastAdd = os.clock()
        if isAdded(item) then return true end
        if not tradeRoot() then return false end
        addGap = math.min(addGap + 0.5, 5)
    end
    return false
end

-- still wanted = Zotac still has it running (stopped, cancelled or timed out = stop). No answer
-- (app busy / restarting) = keep going.
local function wanted(job)
    local r = api("GET", "/jobs/" .. job.id)
    return not (r and r.status and r.status ~= "running")
end

local function readyAndAccept(root, who, reReady)
    task.wait(0.4)
    local readyAt = os.clock()
    local readied = false
    while os.clock() - readyAt < 12 and tradeRoot() do
        local yr = root:FindFirstChild("Your") and root.Your:FindFirstChild("Ready")
        if yr and yr.Visible then readied = true break end
        local b = buttonWithText(root, "READY")
        if not b and buttonWithText(root, "ACCEPT", "CONFIRM") then readied = true break end
        if b then fire(b.Activated, nil, 1) end
        task.wait(1.2)
    end
    if not tradeRoot() then return false, who .. " closed the trade", true end
    if not readied then cancelTrade(); return false, "could not press READY" end
    notify("Ready - waiting for " .. who .. " to accept")

    -- once both sides are ready the game shows a short "Xs Left" countdown with ACCEPT greyed out
    -- (presses are ignored), then ACCEPT works; pressing it shows "Confirmed!" on your offer
    -- (proof video 2026-10-16). Press only after the countdown, until Confirmed!, never after.
    local function textShown(under, pattern)
        for _, d in ipairs(under and under:GetDescendants() or {}) do
            if d:IsA("TextLabel") and shown(d) and string.find(d.Text:gsub("<[^>]->", ""), pattern) then return true end
        end
        return false
    end
    local acceptT0, presses, readies, lastPress, countdownSince = os.clock(), 0, 0, -99, nil
    while tradeRoot() and os.clock() - acceptT0 < ACCEPT_TIMEOUT do
        local confirmed = textShown(root:FindFirstChild("Your"), "^%s*Confirmed")
            or (textShown(root, "^%s*Confirmed") and not textShown(root:FindFirstChild("Other"), "^%s*Confirmed"))
        local counting = textShown(root, "%d+%s*s%s+Left")
        if counting then countdownSince = countdownSince or os.clock() else countdownSince = nil end
        local waitCount = counting and os.clock() - countdownSince < 15   -- a timer that never ends is ignored
        local b = not confirmed and buttonWithText(root, "ACCEPT", "CONFIRM")
        if b and not waitCount and presses < 30 and os.clock() - lastPress > 1.5 then
            presses += 1; lastPress = os.clock()
            fire(b.Activated, nil, 1)
            task.wait(0.3)
        elseif not confirmed and reReady and readies < 5 and buttonWithText(root, "READY") then
            readies += 1
            fire(buttonWithText(root, "READY").Activated, nil, 1)
            task.wait(1.2)
        else
            task.wait(0.25)
        end
    end
    if tradeRoot() then cancelTrade(); return false, who .. " did not accept in time" end
    return true
end

local function isMe(owner)
    if owner == nil then return false end
    if typeof(owner) == "Instance" then return owner == LP end
    if type(owner) == "number" then return owner == LP.UserId end
    if type(owner) == "string" then return owner == LP.Name or owner == tostring(LP.UserId) end
    if type(owner) == "table" then
        local id = rawget(owner, "UserId") or rawget(owner, "userId")
        local nm = rawget(owner, "Name") or rawget(owner, "name")
        return id == LP.UserId or nm == LP.Name
    end
    return false
end
local ownPlotName = nil
local function ownPlotFromData(plots)
    if ownPlotName and plots:FindFirstChild(ownPlotName) then return plots[ownPlotName] end
    if not getgc then return nil end
    local ok, gc = pcall(getgc, true)
    if not ok then return nil end
    for _, v in ipairs(gc) do
        if type(v) == "table" then
            local oi, idx = pcall(rawget, v, "Index")
            if oi and type(idx) == "string" then
                local oc, ct = pcall(rawget, v, "CacheTable")
                if oc and type(ct) == "table" then
                    local oo, owner = pcall(function() return ct.Owner end)
                    if oo and isMe(owner) and plots:FindFirstChild(idx) then
                        ownPlotName = idx
                        return plots[idx]
                    end
                end
            end
        end
    end
    return nil
end
local function findMyPlot()
    local plots = workspace:FindFirstChild("Plots")
    if not plots then return nil end
    local p = ownPlotFromData(plots)
    if p then return p end
    local byName, names = nil, 0
    local want1, want2 = string.lower(LP.DisplayName .. "'s base"), string.lower(LP.Name .. "'s base")
    for _, plot in ipairs(plots:GetChildren()) do
        local sign = plot:FindFirstChild("PlotSign")
        for _, d in ipairs(sign and sign:GetDescendants() or {}) do
            if d:IsA("TextLabel") then
                if d.Text == "YOUR BASE" then
                    local gui = d:FindFirstAncestorWhichIsA("LayerCollector")
                    if gui and gui.Enabled then return plot end
                end
                local t = string.lower(d.Text)
                if (t == want1 or t == want2) and byName ~= plot then byName = plot; names += 1 end
            end
        end
    end
    if names == 1 then return byName end
    return nil
end
local function countInBase(pet)
    local plot, n = findMyPlot(), 0
    for _, c in ipairs(plot and plot:GetChildren() or {}) do
        if c:IsA("Model") and c:GetAttribute("__AssetDescendantCount") ~= nil and norm(c.Name) == norm(pet.name) then
            local m = norm(c:GetAttribute("Mutation") or "none")
            local want = norm(pet.mutation or "none")
            if m == want or ((m == "" or m == "none" or m == "normal") and (want == "" or want == "none" or want == "normal")) then n += 1 end
        end
    end
    return n, plot ~= nil
end

local function deliverOnce(job)
    local buyer, uid = job.buyerUsername, tonumber(job.buyerUserId)
    if not buyer or buyer == "" then return false, "job has no buyer username" end
    if #(job.pets or {}) == 0 then return false, "job has no pets" end

    local want = {}
    for _, p in ipairs(job.pets) do
        local k = norm(p.name) .. "|" .. norm(p.mutation)
        want[k] = want[k] or {pet = p, n = 0, gens = {}}
        want[k].n += 1
        table.insert(want[k].gens, tonumber(p.gen) or 0)
    end
    local before = {}
    for k, w in pairs(want) do
        -- right after joining, the base and its pets stream in over several seconds (a job picked
        -- up 10 s after launch saw "only 0 in base"): give it up to 30 s before giving up
        local tBase = os.clock()
        before[k] = countInBase(w.pet)
        while before[k] < w.n and os.clock() - tBase < 30 and running do
            task.wait(1)
            before[k] = countInBase(w.pet)
        end
        if before[k] < w.n then
            local m = tostring(w.pet.mutation or "")
            local label = (m == "" or m == "None" or m == "Normal") and w.pet.name or (m .. " " .. w.pet.name)
            return false, ("only %d %s in base"):format(before[k], label)
        end
    end

    if tradeRoot() then cancelTrade(); task.wait(1.5) end
    local inviteFor = tonumber(job.inviteTimeout) or INVITE_TIMEOUT
    local t0, lastSend, root, lastWant = os.clock(), -RESEND_EVERY, nil, os.clock()
    while os.clock() - t0 < inviteFor do
        if not running then return false, "agent stopped" end
        if os.clock() - lastWant > 5 then
            lastWant = os.clock()
            if not wanted(job) then return false, "cancelled by Zotac" end
        end
        root = tradeRoot()
        if root then
            local who = tradePartner(root)
            if who and string.lower(who) == string.lower(buyer) then break end
            log("warn", "trade window opened with @" .. tostring(who) .. ", not the buyer - cancelling")
            cancelTrade(); root = nil; task.wait(2)
        end
        if os.clock() - lastSend >= RESEND_EVERY then
            local ok, why = sendTrade(buyer, uid)
            lastSend = os.clock()
            if not ok then
                if string.find(why, "offline") or string.find(why, "not found") then return false, why end
                log("warn", why)
            else
                notify("Trade sent to @" .. buyer)
            end
        end
        task.wait(0.5)
    end
    if not root then return false, "buyer did not accept the trade request" end
    notify("Trade open with @" .. buyer .. " - adding " .. #job.pets .. " brainrot(s)")

    local used = {}
    for k, w in pairs(want) do
        local m = tostring(w.pet.mutation or "")
        local label = ((m == "" or m == "None" or m == "Normal") and "" or (m .. " ")) .. w.pet.name

        local level, count, tSearch = 0, 0, os.clock()
        repeat
            level, count = 0, 0
            for _, it in ipairs(yourItems(root)) do
                local sc = matchScore(it, w.pet)
                if sc > level then level, count = sc, 1 elseif sc > 0 and sc == level then count += 1 end
            end
            if (level > 0 and count >= w.n) or not tradeRoot() then break end
            task.wait(0.5)
        until os.clock() - tSearch > 8
        if level == 0 or count < w.n then
            local seen = {}
            for _, it in ipairs(yourItems(root)) do table.insert(seen, it.title) end
            log("warn", "trade window items: " .. table.concat(seen, ", "):sub(1, 400))
            cancelTrade()
            return false, label .. " not found in the trade window" .. (count > 0 and (" (only " .. count .. " of " .. w.n .. ")") or "")
        end

        for i = 1, w.n do
            if not tradeRoot() then return false, "buyer closed the trade", true end
            local target, pick, bestD = w.gens[i] or w.gens[1] or 0, nil, math.huge
            for _, it in ipairs(yourItems(root)) do
                if not used[it.frame] and not isAdded(it) and matchScore(it, w.pet) == level then
                    local dd = math.abs((it.gen or 0) - target)
                    if dd < bestD then pick, bestD = it, dd end
                end
            end
            if not pick then cancelTrade(); return false, label .. " not found in the trade window (only " .. (i - 1) .. " of " .. w.n .. ")" end
            if not addItem(pick) then cancelTrade(); return false, "could not add " .. pick.title end
            used[pick.frame] = true
        end
    end

    local added = 0
    for _, it in ipairs(yourItems(root)) do if isAdded(it) then added += 1 end end
    if added ~= #job.pets then cancelTrade(); return false, ("offer has %d items, expected %d"):format(added, #job.pets) end

    local okRA, whyRA, cancelledRA = readyAndAccept(root, "buyer")
    if not okRA then return false, whyRA, cancelledRA end

    local deadline = os.clock() + 12
    repeat
        task.wait(1)
        local allGone = true
        for k, w in pairs(want) do
            if countInBase(w.pet) > before[k] - w.n then allGone = false end
        end
        if allGone then return true end
    until os.clock() > deadline
    return false, "trade closed but the brainrots are still in your base (cancelled?)", true
end

-- The buyer cancelling the trade window (or closing it before ACCEPT) is not a failed delivery:
-- the trade is sent again and the pets re-added, up to 3 rounds per job. Zotac is told each time
-- (it messages the buyer and restarts the job's timer). Never re-sent when the pets already left.
local REOFFERS = 3
local function deliver(job)
    local rounds = tonumber(job.maxRounds) or REOFFERS
    local why
    for round = 1, rounds do
        local ok, w, cancelled = deliverOnce(job)
        if ok then return true end
        why = w
        if not cancelled or round == rounds or not running or not wanted(job) then break end
        log("warn", ("%s cancelled the trade (%s) - sending it again (%d/%d)"):format("buyer", tostring(w), round, rounds - 1))
        api("POST", "/jobs/" .. job.id .. "/event", {event = "buyer_cancelled", round = round, reason = w})
        notify("Trade cancelled - sending it again")
        task.wait(3)
    end
    return false, why
end

-- ===================== Security mode: steal from a Legit stock account =====================
-- The stock account sits in the private server with real Roblox (no executor). This account (the
-- mother) walks into its base, steals the ordered pets with the game's own steal prompt and walks
-- them home. Only normal play: pathfinding walk at normal speed (no teleport, no speed change), the
-- prompt held with InputHoldBegin/End for its own HoldDuration, nothing else touched.
local PathfindingService = game:GetService("PathfindingService")
local STEAL_WAIT_PLAYER = 240

local function stripTags(t) return (tostring(t or ""):gsub("<[^>]->", "")) end
local plotCache, plotCacheAt = nil, 0
local function plotCaches()
    if plotCache and os.clock() - plotCacheAt < 10 then return plotCache end
    plotCache, plotCacheAt = {}, os.clock()
    if not getgc then return plotCache end
    local ok, gc = pcall(getgc, true)
    if not ok then return plotCache end
    for _, v in ipairs(gc) do
        if type(v) == "table" then
            local oi, idx = pcall(rawget, v, "Index")
            if oi and type(idx) == "string" then
                local oc, ct = pcall(rawget, v, "CacheTable")
                if oc and type(ct) == "table" and not plotCache[idx] then plotCache[idx] = ct end
            end
        end
    end
    return plotCache
end
local function plotOwnedBy(plr)
    local plots = workspace:FindFirstChild("Plots")
    if not plots then return nil end
    for _, plot in ipairs(plots:GetChildren()) do
        local ct = plotCaches()[plot.Name]
        local ok, owner = pcall(function() return ct and ct.Owner end)
        if ok and owner ~= nil then
            if (typeof(owner) == "Instance" and owner == plr) or owner == plr.UserId or owner == plr.Name
                or (type(owner) == "table" and (rawget(owner, "UserId") == plr.UserId or rawget(owner, "Name") == plr.Name)) then return plot end
        end
    end
    for _, plot in ipairs(plots:GetChildren()) do   -- the sign: "<display name>'s base"
        local sign = plot:FindFirstChild("PlotSign")
        for _, d in ipairs(sign and sign:GetDescendants() or {}) do
            if d:IsA("TextLabel") then
                local who = stripTags(d.Text):match("^(.-)'s [Bb]ase$")
                if who and (who == plr.DisplayName or who == plr.Name) then return plot end
            end
        end
    end
    return nil
end
local function isPetModel(inst) return inst:IsA("Model") and inst:GetAttribute("__AssetDescendantCount") ~= nil end
-- every brainrot has its own uuid: read from the plot cache entry or the pet model's attributes
-- (only reading what the client already has), so Zotac knows "same pet" from "new identical pet"
local UUID_KEYS = {"UUID", "Uuid", "uuid", "AnimalUUID", "AnimalUuid", "AnimalId", "Guid", "GUID", "Id", "ID", "id"}
local function normUuid(v)
    if type(v) ~= "string" then return nil end
    local s = string.lower((v:gsub("[{}]", "")))
    if s:match("^%x%x%x%x%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%x%x%x%x%x%x%x%x$") then return s end
    return nil
end
local function modelUuid(model)
    for _, k in ipairs(UUID_KEYS) do
        local u = normUuid(model:GetAttribute(k))
        if u then return u, "model." .. k end
    end
    local ok, attrs = pcall(function() return model:GetAttributes() end)
    if ok then for k, v in pairs(attrs) do local u = normUuid(v); if u then return u, "model." .. k end end end
    return nil
end

local function mutOk(model, pet)
    local m = norm(model:GetAttribute("Mutation") or "none")
    local want = norm(pet.mutation or "none")
    local plainM, plainW = (m == "" or m == "none" or m == "normal"), (want == "" or want == "none" or want == "normal")
    return m == want or (plainM and plainW)
end
local function genNear(model)
    local debris = workspace:FindFirstChild("Debris")
    local pos, best, bestD = model:GetPivot().Position, nil, 12
    for _, part in ipairs(debris and debris:GetChildren() or {}) do
        local gui = part:IsA("BasePart") and part:FindFirstChild("AnimalOverhead")
        local nm = gui and gui:FindFirstChild("DisplayName")
        if nm and stripTags(nm.Text) == model.Name then
            local p = part.Position
            local d = Vector2.new(p.X - pos.X, p.Z - pos.Z).Magnitude
            if d < bestD then best, bestD = gui, d end
        end
    end
    local g = best and best:FindFirstChild("Generation")
    return g and parseMoney(g.Text) or nil
end
-- the steal prompt of the podium a pet stands on
local function stealPromptFor(plot, model)
    local podiums = plot:FindFirstChild("AnimalPodiums")
    local pos, best, bestD = model:GetPivot().Position, nil, 20
    for _, pod in ipairs(podiums and podiums:GetChildren() or {}) do
        local ok, cf = pcall(function() return pod:GetPivot() end)
        if ok then
            local d = Vector2.new(cf.Position.X - pos.X, cf.Position.Z - pos.Z).Magnitude
            if d < bestD then best, bestD = pod, d end
        end
    end
    if not best then return nil end
    local att = best:FindFirstChild("PromptAttachment", true)
    for _, p in ipairs((att and att:GetChildren()) or best:GetDescendants()) do
        if p:IsA("ProximityPrompt") and string.find(string.lower(p.ActionText or ""), "steal", 1, true) then return p, best end
    end
    for _, p in ipairs(best:GetDescendants()) do if p:IsA("ProximityPrompt") then return p, best end end
    return nil, best
end
local function promptPos(p)
    local par = p and p.Parent
    if par and par:IsA("Attachment") then return par.WorldPosition end
    if par and par:IsA("BasePart") then return par.Position end
    return nil
end
-- walk like a player: pathfinding waypoints at the character's own speed
local function walkTo(pos, within, timeout)
    local char = LP.Character
    local hum = char and char:FindFirstChildOfClass("Humanoid")
    local root = char and char:FindFirstChild("HumanoidRootPart")
    if not (hum and root and pos) then return false end
    local t0 = os.clock()
    local function close() return (root.Position - pos).Magnitude <= within end
    local path = PathfindingService:CreatePath({AgentRadius = 2, AgentHeight = 5, AgentCanJump = true, WaypointSpacing = 6})
    local okP = pcall(function() path:ComputeAsync(root.Position, pos) end)
    if okP and path.Status == Enum.PathStatus.Success then
        for _, wp in ipairs(path:GetWaypoints()) do
            if not running or os.clock() - t0 > timeout then break end
            if wp.Action == Enum.PathWaypointAction.Jump then hum.Jump = true end
            hum:MoveTo(wp.Position)
            local w0 = os.clock()
            repeat RunService.Heartbeat:Wait() until (root.Position - wp.Position).Magnitude < 4 or os.clock() - w0 > 4 or not running
            if close() then return true end
        end
    end
    while not close() and os.clock() - t0 < timeout and running do   -- straight walk for the last bit
        hum:MoveTo(pos)
        local w0 = os.clock()
        repeat RunService.Heartbeat:Wait() until close() or os.clock() - w0 > 3
    end
    return close()
end
-- ---------- recorded base routes ----------
-- job.route = the way into a base the user walked by hand (scanner/zotac_path_recorder.lua), relative
-- to the base's pivot (every base is the same model): nodes {x, y, z, kind} (0 walk, 1 ladder,
-- 2 in the air), one-way edges (0-based), slots[podium] = where to stand to steal, exits = ground
-- spots at the front / outside where the walk home starts. Walked with MoveTo like a player; a
-- ladder is climbed by walking into it (Humanoid:Move), like holding W.
local function nodeWorld(route, pivot, i)
    local n = route.nodes[i]
    return pivot:PointToWorldSpace(Vector3.new(n[1], n[2], n[3]))
end
local function routePath(route, from, goals)
    local n = #route.nodes
    local adj = {}
    for i = 1, n do adj[i] = {} end
    for _, e in ipairs(route.edges) do
        local a, b = e[1] + 1, e[2] + 1
        local A, B = route.nodes[a], route.nodes[b]
        if A and B then table.insert(adj[a], {b, math.sqrt((A[1] - B[1]) ^ 2 + (A[3] - B[3]) ^ 2) + math.abs(A[2] - B[2]) * 0.5}) end
    end
    local dist, prev, done = {}, {}, {}
    for i = 1, n do dist[i] = math.huge end
    dist[from] = 0
    while true do
        local u, du = nil, math.huge
        for i = 1, n do if not done[i] and dist[i] < du then u, du = i, dist[i] end end
        if not u then return nil end
        if goals[u] then
            local path, x = {}, u
            while x do table.insert(path, 1, x); x = prev[x] end
            return path
        end
        done[u] = true
        for _, e in ipairs(adj[u]) do
            if du + e[2] < dist[e[1]] then dist[e[1]] = du + e[2]; prev[e[1]] = u end
        end
    end
end
-- the walk node nearest to pos (only nodes in "only" when given)
local function nearestNode(route, pivot, pos, only)
    local best, bestD = nil, math.huge
    local list = only or {}
    if not only then for i = 1, #route.nodes do list[i] = i - 1 end end
    for _, i0 in ipairs(list) do
        local i = i0 + 1
        local n = route.nodes[i]
        if n and n[4] == 0 then
            local d = (nodeWorld(route, pivot, i) - pos).Magnitude
            if d < bestD then best, bestD = i, d end
        end
    end
    return best, bestD
end
local function followRoute(route, pivot, path, timeout)
    local char = LP.Character
    local hum = char and char:FindFirstChildOfClass("Humanoid")
    local root = char and char:FindFirstChild("HumanoidRootPart")
    if not (hum and root) then return false end
    local t0, lastDir = os.clock(), nil
    for _, i in ipairs(path) do
        if not running or os.clock() - t0 > timeout then hum:Move(Vector3.zero); return false end
        local n = route.nodes[i]
        local wp = nodeWorld(route, pivot, i)
        local flatV = (wp - root.Position) * Vector3.new(1, 0, 1)
        if n[4] == 1 then
            local dir = flatV.Magnitude > 0.3 and flatV.Unit or lastDir
            local tC = os.clock()
            while dir and root.Position.Y < wp.Y - 0.7 and os.clock() - tC < 4 and running do
                hum:Move(dir, false)
                RunService.Heartbeat:Wait()
            end
            if dir then lastDir = dir end
        else
            if flatV.Magnitude > 0.3 then lastDir = flatV.Unit end
            hum:MoveTo(wp)
            local tW, lastPos, still = os.clock(), root.Position, os.clock()
            repeat
                RunService.Heartbeat:Wait()
                if (root.Position - lastPos).Magnitude > 0.5 then lastPos, still = root.Position, os.clock()
                elseif os.clock() - still > 1 then hum.Jump = true; still = os.clock() end   -- caught on a step
            until ((wp - root.Position) * Vector3.new(1, 0, 1)).Magnitude < 1.8 or os.clock() - tW > 4 or not running
        end
    end
    hum:Move(Vector3.zero)
    return true
end
-- into a base along the recorded way: to its front on open ground, then the route to that podium
local function routeTo(route, plot, slot)
    local goal = route.slots and route.slots[tostring(slot)]
    local root = LP.Character and LP.Character:FindFirstChild("HumanoidRootPart")
    if goal == nil or not root then return false end
    local pivot = plot:GetPivot()
    local start, d = nearestNode(route, pivot, root.Position)
    if not start or d > 6 then
        start = nearestNode(route, pivot, root.Position, route.exits)
        if not start or not walkTo(nodeWorld(route, pivot, start), 3, 60) then return false end
    end
    local path = routePath(route, start, {[goal + 1] = true})
    return path ~= nil and followRoute(route, pivot, path, 120)
end
-- out of a base along the recorded way, down to the ground at its front / outside
local function routeOut(route, plot)
    local root = LP.Character and LP.Character:FindFirstChild("HumanoidRootPart")
    if not root or type(route.exits) ~= "table" then return false end
    local pivot = plot:GetPivot()
    local start, d = nearestNode(route, pivot, root.Position)
    if not start or d > 8 then return false end
    local goals = {}
    for _, e in ipairs(route.exits) do goals[e + 1] = true end
    local path = routePath(route, start, goals)
    return path ~= nil and followRoute(route, pivot, path, 120)
end
local function inRange(p)
    local root = LP.Character and LP.Character:FindFirstChild("HumanoidRootPart")
    local pp = promptPos(p)
    return root and pp and (root.Position - pp).Magnitude <= (tonumber(p.MaxActivationDistance) or 10) - 0.5
end

local function holdPrompt(p)
    local okB = pcall(function() p:InputHoldBegin() end)
    if not okB then return false end
    task.wait((tonumber(p.HoldDuration) or 1) + 0.25)
    pcall(function() p:InputHoldEnd() end)
    return true
end

-- took = ids of the pets that landed in this base (reported even when a later pet fails, so
-- Zotac books every pet that really moved)
local function stealPets(job, took)
    local from = tostring(job.fromUsername or "")
    if from == "" or #(job.pets or {}) == 0 then return false, "job has no stock account or pets" end
    -- 1. the stock account must be in this server (Zotac opens it with real Roblox)
    notify("Waiting for @" .. from .. " to join")
    local plr, t0, lastWant = nil, os.clock(), os.clock()
    repeat
        plr = Players:FindFirstChild(from)
        if not plr then
            task.wait(1)
            if os.clock() - lastWant > 5 then lastWant = os.clock(); if not wanted(job) then return false, "cancelled by Zotac" end end
        end
    until plr or os.clock() - t0 > STEAL_WAIT_PLAYER or not running
    if not plr then return false, "@" .. from .. " never joined the private server" end
    -- 2. its base, with the pets loaded
    local plot, tp = nil, os.clock()
    repeat plot = plotOwnedBy(plr); if not plot then task.wait(1) end until plot or os.clock() - tp > 60
    if not plot then return false, "base of @" .. from .. " not found" end
    local home = findMyPlot()
    local hit = home and home:FindFirstChild("DeliveryHitbox", true)
    local homePos = hit and hit:IsA("BasePart") and hit.Position or (home and home:GetPivot().Position)
    if not homePos then return false, "own base not found" end
    local used = {}
    local route = type(job.route) == "table" and type(job.route.nodes) == "table" and #job.route.nodes > 1 and job.route or nil
    for i, pet in ipairs(job.pets) do
        if not running then return false, "agent stopped" end
        local mineBefore = countInBase(pet)
        -- the matching pet in their base (closest gen/s once its name tag is in range)
        local target, tFind = nil, os.clock()
        repeat
            local best, bestD = nil, math.huge
            -- the exact pet when the scan gave Zotac its uuid
            if pet.uuid then
                for _, c in ipairs(plot:GetChildren()) do
                    if isPetModel(c) and not used[c] and modelUuid(c) == pet.uuid then best, bestD = c, -1 break end
                end
            end
            for _, c in ipairs(bestD < 0 and {} or plot:GetChildren()) do
                if isPetModel(c) and not used[c] and norm(c.Name) == norm(pet.name) and mutOk(c, pet) then
                    local g = genNear(c)
                    local d = g and math.abs(g - (tonumber(pet.gen) or 0)) or 1e15
                    if d < bestD then best, bestD = c, d end
                end
            end
            target = best
            if not target then task.wait(1) end
        until target or os.clock() - tFind > 30
        if not target then return false, pet.name .. " not found in @" .. from .. "'s base" end
        local prompt, podium = stealPromptFor(plot, target)
        if not prompt then return false, "no steal prompt at " .. pet.name end
        -- 3. walk there (the recorded way into the base; pathfinding only without a route), steal
        -- (a locked base keeps the prompt off: wait for it)
        local walked = route and podium and routeTo(route, plot, podium.Name)
        if route and not walked then log("warn", "recorded route to podium " .. tostring(podium and podium.Name) .. " did not get there - trying pathfinding") end
        if not inRange(prompt) and not walkTo(promptPos(prompt) or target:GetPivot().Position, math.max(4, (prompt.MaxActivationDistance or 10) - 2), 60) then return false, "could not walk to " .. pet.name end
        local tE = os.clock()
        while not prompt.Enabled and os.clock() - tE < 70 do task.wait(1) end
        if not prompt.Enabled then return false, "@" .. from .. "'s base stays locked" end
        local got = false
        for _ = 1, 3 do
            holdPrompt(prompt)
            local tS = os.clock()
            repeat task.wait(0.2) until LP:GetAttribute("Stealing") == true or os.clock() - tS > 3
            if LP:GetAttribute("Stealing") == true then got = true break end
            walkTo(promptPos(prompt) or target:GetPivot().Position, 4, 10)
        end
        if not got then return false, "steal prompt did not pick up " .. pet.name end
        notify(("Took %s (%d/%d) - walking home"):format(pet.name, i, #job.pets))
        -- 4. home: out of their base the recorded way, then into your own base's delivery spot
        if route and not routeOut(route, plot) then log("warn", "recorded way out did not work - walking home directly") end
        walkTo(homePos, 4, 90)
        local tH = os.clock()
        repeat task.wait(0.5) until LP:GetAttribute("Stealing") ~= true or os.clock() - tH > 20
        if LP:GetAttribute("Stealing") == true then return false, "could not bring " .. pet.name .. " home" end
        local tC = os.clock()
        repeat task.wait(0.5) until countInBase(pet) > mineBefore or os.clock() - tC > 12
        if countInBase(pet) <= mineBefore then return false, pet.name .. " did not land in your base" end
        used[target] = true
        table.insert(took, pet.id)
        log("info", ("stole %s from @%s (%d/%d)"):format(pet.name, from, i, #job.pets))
    end
    return true
end
local function steal(job)
    local took = {}
    local okS, okDone, why = pcall(stealPets, job, took)
    if not okS then return false, "script error: " .. tostring(okDone), took end
    return okDone, why, took
end

if not game:IsLoaded() then game.Loaded:Wait() end
task.wait(4)
if ZOTAC_TOKEN == "PASTE_AGENT_TOKEN" then notify("Copy this script from Zotac so the token is filled in") return end
if not httpRequest then notify("Your executor has no request() - cannot reach Zotac") return end
notify("Delivery agent online for @" .. LP.Name)

local lastBeat = 0
local closeAt = nil
while running do
    if closeAt and os.clock() >= closeAt then
        notify("All deliveries done - closing this Roblox client")
        log("info", "idle after delivery - closing the game")
        api("POST", "/heartbeat", {account = LP.Name, closing = true})
        task.wait(1.5)
        pcall(function() game:Shutdown() end)
        task.wait(3)
        pcall(function() LP:Kick("Zotac: deliveries done") end)
        break
    end
    if os.clock() - lastBeat > 30 then api("POST", "/heartbeat", {account = LP.Name}); lastBeat = os.clock() end
    local r = api("GET", "/jobs?account=" .. HttpService:UrlEncode(LP.Name))
    local job = r and r.job
    if job then
        closeAt = nil
        if job.kind == "steal" then
            log("info", ("job %s: take %d brainrot(s) from @%s's base"):format(job.id, #(job.pets or {}), tostring(job.fromUsername)))
        else
            log("info", ("job %s: %d brainrot(s) -> @%s"):format(job.id, #(job.pets or {}), tostring(job.buyerUsername)))
        end
        local ok, okDone, why, moved = pcall(job.kind == "steal" and steal or deliver, job)
        if not ok then okDone, why = false, "script error: " .. tostring(okDone) end
        api("POST", "/jobs/" .. job.id, {status = okDone and "done" or "failed", reason = why, moved = moved})
        notify(okDone and (job.kind == "steal" and ("Took the pets from @" .. tostring(job.fromUsername)) or ("Delivered to @" .. tostring(job.buyerUsername))) or ("Delivery failed: " .. tostring(why)))
        log(okDone and "info" or "warn", ("job %s %s%s"):format(job.id, okDone and "done" or "failed", why and (" - " .. why) or ""))
        if job.closeWhenIdle then closeAt = os.clock() + 15 end
    else
        task.wait(3)
    end
end
