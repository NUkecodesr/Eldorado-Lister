-- Zotac Steal Tester: pick a pet in another base, press Go: walks the recorded route to its podium,
-- holds the steal prompt, takes the recorded way out and walks home. Status on screen.
-- Only normal play: MoveTo / walking into the ladder, the game's own prompt. No remotes.
if _G.ZotacStealTest and _G.ZotacStealTest.Stop then pcall(_G.ZotacStealTest.Stop) end
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local HttpService = game:GetService("HttpService")
local LP = Players.LocalPlayer
local route = HttpService:JSONDecode(readfile("zotac_route.json"))
local stopFlag, busy, conns = false, false, {}

local view = Instance.new("Folder"); view.Name = "ZotacStealView"; view.Parent = workspace
local function dot(pos, color, size)
    local p = Instance.new("Part")
    p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch = true, false, false, false
    p.Material = Enum.Material.Neon; p.Shape = Enum.PartType.Ball
    p.Size = Vector3.new(size, size, size); p.Color = color; p.CFrame = CFrame.new(pos); p.Parent = view
    return p
end
local function stripTags(t) return (tostring(t or ""):gsub("<[^>]->", "")) end
local function isPet(m) return m:IsA("Model") and m:GetAttribute("__AssetDescendantCount") ~= nil end
local function myPlot()
    for _, plot in ipairs(workspace.Plots:GetChildren()) do
        for _, d in ipairs(plot.PlotSign:GetDescendants()) do
            if d:IsA("TextLabel") and d.Text == "YOUR BASE" then
                local g = d:FindFirstAncestorWhichIsA("LayerCollector")
                if g and g.Enabled then return plot end
            end
        end
    end
end
local function ownerText(plot)
    for _, d in ipairs(plot.PlotSign:GetDescendants()) do
        if d:IsA("TextLabel") and d.Text ~= "" then
            local g = d:FindFirstAncestorWhichIsA("LayerCollector")
            if g and g.Enabled then return stripTags(d.Text) end
        end
    end
    return plot.Name:sub(1, 8)
end
-- podium a pet stands on: 3D nearest (floors are stacked)
local function podiumOf(plot, model)
    local pos, best, bestD = model:GetPivot().Position, nil, 20
    for _, pod in ipairs(plot.AnimalPodiums:GetChildren()) do
        local d = (pod:GetPivot().Position - pos).Magnitude
        if d < bestD then best, bestD = pod, d end
    end
    return best
end
local function promptOf(pod)
    for _, p in ipairs(pod:GetDescendants()) do if p:IsA("ProximityPrompt") then return p end end
end
local function promptPos(p)
    local par = p and p.Parent
    if par and par:IsA("Attachment") then return par.WorldPosition end
    if par and par:IsA("BasePart") then return par.Position end
end

-- ---------- GUI ----------
local gui = Instance.new("ScreenGui"); gui.Name = "ZotacStealTester"; gui.ResetOnSpawn = false
gui.Parent = (gethui and gethui()) or game:GetService("CoreGui")
local frame = Instance.new("Frame"); frame.Size = UDim2.fromOffset(300, 330); frame.Position = UDim2.fromOffset(20, 200)
frame.BackgroundColor3 = Color3.fromRGB(21, 17, 12); frame.BorderSizePixel = 0; frame.Active, frame.Draggable = true, true; frame.Parent = gui
Instance.new("UICorner", frame).CornerRadius = UDim.new(0, 10)
local st = Instance.new("UIStroke", frame); st.Color = Color3.fromRGB(242, 182, 49); st.Transparency = 0.5
local function lbl(text, y, h, size, color, bold)
    local l = Instance.new("TextLabel"); l.BackgroundTransparency = 1; l.Size = UDim2.new(1, -20, 0, h); l.Position = UDim2.fromOffset(10, y)
    l.Font = bold and Enum.Font.GothamBold or Enum.Font.Gotham; l.TextSize = size; l.TextColor3 = color or Color3.fromRGB(241, 233, 220)
    l.TextXAlignment = Enum.TextXAlignment.Left; l.TextYAlignment = Enum.TextYAlignment.Top; l.TextWrapped = true; l.Text = text; l.Parent = frame
    return l
end
lbl("ZOTAC STEAL TESTER", 8, 18, 13, Color3.fromRGB(242, 182, 49), true)
local status = lbl("Pick a pet, press Go.", 28, 46, 12, Color3.fromRGB(190, 180, 165))
local list = Instance.new("ScrollingFrame"); list.Size = UDim2.new(1, -20, 0, 190); list.Position = UDim2.fromOffset(10, 78)
list.BackgroundColor3 = Color3.fromRGB(30, 25, 18); list.BorderSizePixel = 0; list.ScrollBarThickness = 4; list.CanvasSize = UDim2.new(); list.AutomaticCanvasSize = Enum.AutomaticSize.Y; list.Parent = frame
local lay = Instance.new("UIListLayout", list); lay.Padding = UDim.new(0, 4)
local function setStatus(t) status.Text = t end
local function btn(parent, text, w, color, fn)
    local b = Instance.new("TextButton"); b.Size = w; b.BackgroundColor3 = color; b.BorderSizePixel = 0; b.Font = Enum.Font.GothamBold; b.TextSize = 12
    b.TextColor3 = Color3.fromRGB(20, 16, 10); b.Text = text; b.Parent = parent
    Instance.new("UICorner", b).CornerRadius = UDim.new(0, 6)
    table.insert(conns, b.Activated:Connect(fn))
    return b
end

-- ---------- walking ----------
local function hr() local c = LP.Character; return c and c:FindFirstChild("HumanoidRootPart"), c and c:FindFirstChildOfClass("Humanoid") end
local function flatDist(a, b) return ((a - b) * Vector3.new(1, 0, 1)).Magnitude end
-- straight walk (open ground), re-issuing MoveTo (it gives up after 8 s), jump when caught
local function walkStraight(pos, within, timeout, label)
    local root, hum = hr()
    local t0, lastPos, still = os.clock(), root.Position, os.clock()
    while flatDist(root.Position, pos) > within and os.clock() - t0 < timeout and not stopFlag do
        hum:MoveTo(pos)
        local w0 = os.clock()
        repeat
            RunService.Heartbeat:Wait()
            if (root.Position - lastPos).Magnitude > 0.5 then lastPos, still = root.Position, os.clock()
            elseif os.clock() - still > 1 then hum.Jump = true; still = os.clock() end
        until flatDist(root.Position, pos) <= within or os.clock() - w0 > 2 or stopFlag
        if label then setStatus(("%s (%.0f studs)"):format(label, flatDist(root.Position, pos))) end
    end
    return flatDist(root.Position, pos) <= within
end
local function W(pivot, i) local n = route.nodes[i]; return pivot:PointToWorldSpace(Vector3.new(n[1], n[2], n[3])) end
local function dijkstra(from, goals)
    local n = #route.nodes
    local adj = {}
    for i = 1, n do adj[i] = {} end
    for _, e in ipairs(route.edges) do
        local a, b = e[1] + 1, e[2] + 1
        local A, B = route.nodes[a], route.nodes[b]
        table.insert(adj[a], {b, math.sqrt((A[1] - B[1]) ^ 2 + (A[3] - B[3]) ^ 2) + math.abs(A[2] - B[2]) * 0.5})
    end
    local dist, prev, done = {}, {}, {}
    for i = 1, n do dist[i] = math.huge end
    dist[from] = 0
    while true do
        local u, du = nil, math.huge
        for i = 1, n do if not done[i] and dist[i] < du then u, du = i, dist[i] end end
        if not u then return nil end
        if goals[u] then local p, x = {}, u; while x do table.insert(p, 1, x); x = prev[x] end; return p end
        done[u] = true
        for _, e in ipairs(adj[u]) do if du + e[2] < dist[e[1]] then dist[e[1]] = du + e[2]; prev[e[1]] = u end end
    end
end
local function nearest(pivot, pos, maxD)
    local best, bestD = nil, maxD or math.huge
    for i, n in ipairs(route.nodes) do
        if n[4] == 0 then local d = (W(pivot, i) - pos).Magnitude; if d < bestD then best, bestD = i, d end end
    end
    return best, bestD
end
-- a ladder: the way into it comes from the route (walk spot before it -> the ladder), never from
-- where the character happens to stand. Line up at its foot, then push into it (like holding W)
-- until the top of the climb; no height gained for a moment = hop onto it and push again.
local function climb(pivot, path, k, label)
    local root, hum = hr()
    local last = k
    while path[last + 1] and route.nodes[path[last + 1]][4] == 1 do last += 1 end
    local topY = -math.huge
    for j = k, last do topY = math.max(topY, W(pivot, path[j]).Y) end
    local first = route.nodes[path[k]]
    local dirRel
    for j = k - 1, 1, -1 do   -- from the last walk spot before the ladder
        local p = route.nodes[path[j]]
        local v = Vector3.new(first[1] - p[1], 0, first[3] - p[3])
        if v.Magnitude > 0.4 then dirRel = v.Unit break end
    end
    if not dirRel and path[last + 1] then   -- else toward where the climb comes out
        local p = route.nodes[path[last + 1]]
        local v = Vector3.new(p[1] - first[1], 0, p[3] - first[3])
        if v.Magnitude > 0.4 then dirRel = v.Unit end
    end
    if not dirRel then return last, false end
    local dir = pivot:VectorToWorldSpace(dirRel)
    local foot = W(pivot, path[k]) - dir * 1.5   -- just in front of the rungs
    hum:MoveTo(foot)
    local tF = os.clock()
    repeat RunService.Heartbeat:Wait() until flatDist(root.Position, foot) < 1 or os.clock() - tF > 2 or stopFlag
    hum:MoveTo(root.Position)   -- end that walk: an active MoveTo would win over the push
    -- push like holding W: Roblox's control script sets the move direction to the keys every frame
    -- (zero when no key is held) at RenderPriority.Input, so the push is set right after it
    local pushing = true
    pcall(function() RunService:UnbindFromRenderStep("ZotacClimbPush") end)
    RunService:BindToRenderStep("ZotacClimbPush", Enum.RenderPriority.Input.Value + 1, function() if pushing then hum:Move(dir, false) end end)
    local t0, bestY, gainAt = os.clock(), root.Position.Y, os.clock()
    while root.Position.Y < topY - 0.5 and os.clock() - t0 < 15 and not stopFlag do
        RunService.Heartbeat:Wait()
        if root.Position.Y > bestY + 0.3 then bestY, gainAt = root.Position.Y, os.clock() end
        if os.clock() - gainAt > 1.5 then hum.Jump = true; gainAt = os.clock() end   -- not grabbing: hop onto it
        setStatus(("%s: climbing %.1f / %.1f (%s)"):format(label, root.Position.Y, topY, hum:GetState().Name))
    end
    -- over the top: keep pushing a moment so the character steps onto the floor
    local tT = os.clock()
    while os.clock() - tT < 0.5 and not stopFlag do RunService.Heartbeat:Wait() end
    pushing = false
    pcall(function() RunService:UnbindFromRenderStep("ZotacClimbPush") end)
    hum:Move(Vector3.zero)
    return last, root.Position.Y >= topY - 0.5
end
-- base lock: the base's lock countdown (Purchases.PlotBlock.Main.BillboardGui.RemainingTime,
-- "86s" / "1:05"). Its lasers go away when it ends, so only the timer counts. The seconds are read
-- once and counted here: the label can keep its last text ("1s") after the lock is over.
local function lockSeconds(plot)
    local n = plot:FindFirstChild("Purchases"); n = n and n:FindFirstChild("PlotBlock"); n = n and n:FindFirstChild("Main"); n = n and n:FindFirstChild("BillboardGui")
    local rt = n and n:FindFirstChild("RemainingTime")
    if not (rt and rt:IsA("TextLabel")) or (n:IsA("BillboardGui") and not n.Enabled) or not rt.Visible then return nil end
    local t = tostring(rt.Text)
    local m, s = t:match("^(%d+):(%d+)$")
    if m then return tonumber(m) * 60 + tonumber(s) end
    local s2 = t:match("^(%d+)s$")
    return s2 and tonumber(s2) or nil
end
local openSince = setmetatable({}, {__mode = "k"})   -- plot -> when its lock was waited out
local function baseLocked(plot)
    local left = lockSeconds(plot)
    if not left or left <= 0 then return false, left end
    -- a leftover "1s"/"2s" right after a lock was waited out is the stale label, not a new lock
    if left <= 2 and openSince[plot] and os.clock() - openSince[plot] < 90 then return false, left end
    return true, left
end
local function waitUnlocked(plot, maxWait)
    local hum = LP.Character and LP.Character:FindFirstChildOfClass("Humanoid")
    local root = LP.Character and LP.Character:FindFirstChild("HumanoidRootPart")
    if hum and root then hum:MoveTo(root.Position) end   -- stop at the line, not in the lasers
    local locked, left = baseLocked(plot)
    if not locked then return true end
    local t0, said = os.clock(), -math.huge
    local openAt = os.clock() + left + 1
    while not stopFlag and os.clock() < openAt and os.clock() - t0 < maxWait do
        local now = lockSeconds(plot)
        -- locked again (more time than is left): wait for that one instead
        if now and now > (openAt - os.clock()) + 3 then openAt = os.clock() + now + 1 end
        left = math.max(0, math.ceil(openAt - os.clock()))
        setStatus(("Base locked - waiting %ds"):format(left))
        task.wait(0.5)
    end
    if os.clock() >= openAt then openSince[plot] = os.clock(); return true end
    return false
end
local boxCache = setmetatable({}, {__mode = "k"})
local function insideBase(plot, pos)
    local b = boxCache[plot]
    if not b then local cf, size = plot:GetBoundingBox(); b = {cf = cf, size = size}; boxCache[plot] = b end
    local lp = b.cf:PointToObjectSpace(pos)
    return math.abs(lp.X) <= b.size.X / 2 and math.abs(lp.Z) <= b.size.Z / 2
end
local function follow(pivot, path, label, plot)
    local root, hum = hr()
    local k = 1
    while k <= #path do
        if stopFlag then return false end
        local i = path[k]
        local n = route.nodes[i]
        local wp = W(pivot, i)
        setStatus(("%s: node %d/%d (%s)"):format(label, k, #path, n[4] == 1 and "ladder" or n[4] == 2 and "drop" or "walk"))
        if n[4] == 1 then
            local last, ok = climb(pivot, path, k, label)
            if not ok then setStatus(("%s: ladder climb FAILED at node %d"):format(label, k)); hum:Move(Vector3.zero); return false end
            k = last + 1
        else
            if plot and insideBase(plot, root.Position) ~= insideBase(plot, wp) and baseLocked(plot) then
                if not waitUnlocked(plot, 120) then setStatus(label .. ": base stayed locked"); return false end
            end
            hum:MoveTo(wp)
            local tW, lastPos, still = os.clock(), root.Position, os.clock()
            repeat
                RunService.Heartbeat:Wait()
                if (root.Position - lastPos).Magnitude > 0.5 then lastPos, still = root.Position, os.clock()
                elseif os.clock() - still > 1 then hum.Jump = true; still = os.clock() end
            until flatDist(root.Position, wp) < 1.8 or os.clock() - tW > 4 or stopFlag
            if flatDist(root.Position, wp) >= 1.8 then setStatus(("%s: STUCK at node %d/%d (%.1f studs off)"):format(label, k, #path, flatDist(root.Position, wp))); task.wait(1.5) end
            k += 1
        end
    end
    hum:Move(Vector3.zero)
    return true
end

local function stealOne(plot, model)
    busy, stopFlag = true, false
    view:ClearAllChildren()
    local pivot = plot:GetPivot()
    local pod = podiumOf(plot, model)
    local prompt = pod and promptOf(pod)
    if not pod or not prompt then setStatus("No podium / prompt for " .. model.Name); busy = false; return end
    local goal = route.slots[pod.Name]
    if goal == nil then setStatus("No recorded spot for podium " .. pod.Name); busy = false; return end
    goal += 1
    local root = hr()
    -- 1. into the base: from the nearest route spot if you are on the route, else from its entry
    local start, d = nearest(pivot, root.Position, 6)
    local entry = (route.entry or 0) + 1
    if not start then
        start = entry
        if not walkStraight(W(pivot, start), 3, 60, "walking to the base entry") then setStatus("Could not reach the entry"); busy = false; return end
    end
    local path = dijkstra(start, {[goal] = true})
    if not path then setStatus("No route to podium " .. pod.Name); busy = false; return end
    for _, i in ipairs(path) do dot(W(pivot, i), Color3.fromRGB(255, 220, 60), 0.7) end
    if not follow(pivot, path, "to podium " .. pod.Name, plot) then setStatus("Stopped"); busy = false; return end
    -- 2. steal
    local pp = promptPos(prompt)
    setStatus(("At podium %s: %.1f studs from the prompt (range %s), prompt %s"):format(pod.Name, pp and (hr().Position - pp).Magnitude or -1, tostring(prompt.MaxActivationDistance), prompt.Enabled and "on" or "OFF"))
    task.wait(0.6)
    local got = false
    for try = 1, 3 do
        if stopFlag then break end
        pcall(function() prompt:InputHoldBegin() end)
        task.wait((tonumber(prompt.HoldDuration) or 1.5) + 0.25)
        pcall(function() prompt:InputHoldEnd() end)
        local tS = os.clock()
        repeat task.wait(0.2) until LP:GetAttribute("Stealing") == true or os.clock() - tS > 3
        if LP:GetAttribute("Stealing") == true then got = true break end
        setStatus(("Hold %d did not pick it up (Stealing=%s)"):format(try, tostring(LP:GetAttribute("Stealing"))))
    end
    if not got then busy = false; return end
    -- 3. out the recorded way, then home
    local here = nearest(pivot, hr().Position, 8)
    local goals = {}
    for _, e in ipairs(route.exits) do goals[e + 1] = true end
    local out = here and dijkstra(here, goals)
    if out then
        for _, i in ipairs(out) do dot(W(pivot, i), Color3.fromRGB(255, 120, 60), 0.7) end
        follow(pivot, out, "out of the base", plot)
    else setStatus("No way out on the route - walking home directly") end
    local home = myPlot()
    local hit = home and home:FindFirstChild("DeliveryHitbox", true)
    if hit then walkStraight(hit.Position, 3, 90, "walking home") end
    local tH = os.clock()
    repeat task.wait(0.3) until LP:GetAttribute("Stealing") ~= true or os.clock() - tH > 15
    setStatus(LP:GetAttribute("Stealing") == true and "Home, but still carrying it (not delivered)" or "Done: " .. model.Name .. " delivered to your base")
    busy = false
end

-- pets in other bases
local function refresh()
    for _, c in ipairs(list:GetChildren()) do if c:IsA("TextButton") then c:Destroy() end end
    local mine = myPlot()
    for _, plot in ipairs(workspace.Plots:GetChildren()) do
        if plot ~= mine then
            for _, m in ipairs(plot:GetChildren()) do
                if isPet(m) then
                    local pod = podiumOf(plot, m)
                    btn(list, ("%s  · slot %s · %s"):format(m.Name, pod and pod.Name or "?", ownerText(plot)), UDim2.new(1, -6, 0, 26), Color3.fromRGB(242, 182, 49), function()
                        if busy then setStatus("Busy - press Stop first"); return end
                        task.spawn(stealOne, plot, m)
                    end).TextXAlignment = Enum.TextXAlignment.Left
                end
            end
        end
    end
end
local row = Instance.new("Frame"); row.BackgroundTransparency = 1; row.Size = UDim2.new(1, -20, 0, 30); row.Position = UDim2.fromOffset(10, 282); row.Parent = frame
btn(row, "Refresh", UDim2.fromOffset(86, 30), Color3.fromRGB(200, 190, 175), refresh).Position = UDim2.fromOffset(0, 0)
btn(row, "■ Stop", UDim2.fromOffset(86, 30), Color3.fromRGB(239, 68, 68), function() stopFlag = true; local _, hum = hr(); if hum then hum:Move(Vector3.zero); hum:MoveTo(hr().Position) end; setStatus("Stopped") end).Position = UDim2.fromOffset(94, 0)
btn(row, "Close", UDim2.fromOffset(86, 30), Color3.fromRGB(90, 80, 70), function() _G.ZotacStealTest.Stop() end).Position = UDim2.fromOffset(188, 0)
refresh()

_G.ZotacStealTest = { Stop = function()
    stopFlag = true
    pcall(function() RunService:UnbindFromRenderStep("ZotacClimbPush") end)
    for _, c in ipairs(conns) do pcall(function() c:Disconnect() end) end
    pcall(function() gui:Destroy() end); pcall(function() view:Destroy() end)
    local old = workspace:FindFirstChild("ZotacRouteView"); if old then old:Destroy() end
end }
return "tester open"
