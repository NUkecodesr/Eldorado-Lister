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
local function sendTrade(name, uid)
    local box, list = tradeMenu()
    if not (box and list) then return false, "the game's trade menu is not loaded" end
    local row = findRow(list, name, uid)
    if not row then
        box.Text = name
        if not fire(box.FocusLost, true, nil) then return false, "trade search box not hooked" end
        local t0 = os.clock()
        repeat RunService.Heartbeat:Wait(); row = findRow(list, name, uid) until row or os.clock() - t0 > 6
    end
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

local function deliver(job)
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
        before[k] = countInBase(w.pet)
        if before[k] < w.n then
            local m = tostring(w.pet.mutation or "")
            local label = (m == "" or m == "None" or m == "Normal") and w.pet.name or (m .. " " .. w.pet.name)
            return false, ("only %d %s in base"):format(before[k], label)
        end
    end

    if tradeRoot() then cancelTrade(); task.wait(1.5) end
    local t0, lastSend, root = os.clock(), -RESEND_EVERY, nil
    while os.clock() - t0 < INVITE_TIMEOUT do
        if not running then return false, "agent stopped" end
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

    for k, w in pairs(want) do

        local cands, best, tSearch = {}, 0, os.clock()
        repeat
            cands, best = {}, 0
            for _, it in ipairs(yourItems(root)) do
                local sc = not isAdded(it) and matchScore(it, w.pet) or 0
                if sc > best then cands, best = {it}, sc elseif sc > 0 and sc == best then table.insert(cands, it) end
            end
            if #cands >= w.n or not tradeRoot() then break end
            task.wait(0.5)
        until os.clock() - tSearch > 8
        if #cands < w.n then
            local seen = {}
            for _, it in ipairs(yourItems(root)) do table.insert(seen, it.title) end
            log("warn", "trade window items: " .. table.concat(seen, ", "):sub(1, 400))
        end
        local target = w.gens[1] or 0
        table.sort(cands, function(a, b) return math.abs((a.gen or 0) - target) < math.abs((b.gen or 0) - target) end)
        if #cands < w.n then
            cancelTrade()
            local m = tostring(w.pet.mutation or "")
            return false, (((m == "" or m == "None" or m == "Normal") and "" or (m .. " ")) .. w.pet.name .. " not found in the trade window")
        end
        for i = 1, w.n do
            if not tradeRoot() then return false, "buyer closed the trade" end
            if not addItem(cands[i]) then cancelTrade(); return false, "could not add " .. cands[i].title end
        end
    end

    local added = 0
    for _, it in ipairs(yourItems(root)) do if isAdded(it) then added += 1 end end
    if added ~= #job.pets then cancelTrade(); return false, ("offer has %d items, expected %d"):format(added, #job.pets) end

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
    if not tradeRoot() then return false, "buyer closed the trade" end
    if not readied then cancelTrade(); return false, "could not press READY" end
    notify("Ready - waiting for @" .. buyer .. " to accept")

    local acceptT0, presses = os.clock(), 0
    while tradeRoot() and os.clock() - acceptT0 < ACCEPT_TIMEOUT do

        local b = buttonWithText(root, "ACCEPT", "CONFIRM")
        if b and presses < 5 then
            presses += 1
            fire(b.Activated, nil, 1)
            task.wait(1.5)
        else
            task.wait(0.25)
        end
    end
    if tradeRoot() then cancelTrade(); return false, "buyer did not accept in time" end

    local deadline = os.clock() + 12
    repeat
        task.wait(1)
        local allGone = true
        for k, w in pairs(want) do
            if countInBase(w.pet) > before[k] - w.n then allGone = false end
        end
        if allGone then return true end
    until os.clock() > deadline
    return false, "trade closed but the brainrots are still in your base (cancelled?)"
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
        log("info", ("job %s: %d brainrot(s) -> @%s"):format(job.id, #(job.pets or {}), tostring(job.buyerUsername)))
        local ok, okDone, why = pcall(deliver, job)
        if not ok then okDone, why = false, "script error: " .. tostring(okDone) end
        api("POST", "/jobs/" .. job.id, {status = okDone and "done" or "failed", reason = why})
        notify(okDone and ("Delivered to @" .. tostring(job.buyerUsername)) or ("Delivery failed: " .. tostring(why)))
        log(okDone and "info" or "warn", ("job %s %s%s"):format(job.id, okDone and "done" or "failed", why and (" - " .. why) or ""))
        if job.closeWhenIdle then closeAt = os.clock() + 15 end
    else
        task.wait(3)
    end
end
