-- Zotac Path Recorder: walk the route to a pet by hand, Zotac learns how to get there.
-- Run it in the executor (not autoexec). Read-only: it records where your character walks
-- (position, jumps/climbs, which base you are in), plus where each base's podiums and steal
-- prompts are. No remotes, no game modules. Saved to the executor workspace as
-- zotac_paths/path_<time>.json (Zotac reads it from there).
if _G.ZotacPathRec and _G.ZotacPathRec.Stop then pcall(_G.ZotacPathRec.Stop) end

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local HttpService = game:GetService("HttpService")
local LP = Players.LocalPlayer

local STEP = 1.0          -- studs between recorded points
local conns, rec = {}, {points = {}, marks = {}, running = false, t0 = 0}
local trail = Instance.new("Folder")
trail.Name = "ZotacPathTrail"
trail.Parent = workspace

local function r1(n) return math.floor(n * 10 + 0.5) / 10 end
local function v3(v) return {r1(v.X), r1(v.Y), r1(v.Z)} end
local function stripTags(t) return (tostring(t or ""):gsub("<[^>]->", "")) end
local function char()
    local c = LP.Character
    return c and c:FindFirstChild("HumanoidRootPart"), c and c:FindFirstChildOfClass("Humanoid")
end

-- bases: bounding box + pivot (paths are stored relative to the base's pivot, so a route
-- recorded in one base works in every base)
local boxes = nil
local function plotBoxes()
    if boxes then return boxes end
    boxes = {}
    local plots = workspace:FindFirstChild("Plots")
    for _, plot in ipairs(plots and plots:GetChildren() or {}) do
        local ok, cf, size = pcall(function() return plot:GetBoundingBox() end)
        local okP, pivot = pcall(function() return plot:GetPivot() end)
        if ok and okP then table.insert(boxes, {plot = plot, cf = cf, size = size, pivot = pivot}) end
    end
    return boxes
end
local function plotAt(pos)
    local best, bestD = nil, math.huge
    for _, b in ipairs(plotBoxes()) do
        local lp = b.cf:PointToObjectSpace(pos)
        if math.abs(lp.X) <= b.size.X / 2 + 1 and math.abs(lp.Z) <= b.size.Z / 2 + 1 then return b, true end
        local d = (b.pivot.Position - pos).Magnitude
        if d < bestD then best, bestD = b, d end
    end
    return best, false
end
local function signOf(plot)
    local sign = plot:FindFirstChild("PlotSign")
    for _, d in ipairs(sign and sign:GetDescendants() or {}) do
        if d:IsA("TextLabel") and d.Text ~= "" then
            local t = stripTags(d.Text)
            if t == "YOUR BASE" then
                local gui = d:FindFirstAncestorWhichIsA("LayerCollector")
                if gui and gui.Enabled then return t end
            elseif t:find("'s [Bb]ase$") then return t end
        end
    end
    return nil
end
local function nearestPodium(b, pos)
    local pods = b.plot:FindFirstChild("AnimalPodiums")
    local best, bestD = nil, 25
    for _, pod in ipairs(pods and pods:GetChildren() or {}) do
        local ok, cf = pcall(function() return pod:GetPivot() end)
        if ok then
            local d = (cf.Position - pos).Magnitude
            if d < bestD then best, bestD = pod, d end
        end
    end
    return best, bestD
end
local function podiumInfo(b)
    local out = {}
    local pods = b.plot:FindFirstChild("AnimalPodiums")
    for _, pod in ipairs(pods and pods:GetChildren() or {}) do
        local ok, cf = pcall(function() return pod:GetPivot() end)
        if ok then
            local e = {slot = pod.Name, rel = v3(b.pivot:PointToObjectSpace(cf.Position))}
            for _, p in ipairs(pod:GetDescendants()) do
                if p:IsA("ProximityPrompt") then
                    local par = p.Parent
                    local wp = par and (par:IsA("Attachment") and par.WorldPosition or (par:IsA("BasePart") and par.Position))
                    if wp then
                        e.prompt = v3(b.pivot:PointToObjectSpace(wp))
                        e.action, e.range, e.hold, e.sight = p.ActionText, p.MaxActivationDistance, p.HoldDuration, p.RequiresLineOfSight
                        break
                    end
                end
            end
            table.insert(out, e)
        end
    end
    table.sort(out, function(x, y) return (tonumber(x.slot) or 0) < (tonumber(y.slot) or 0) end)
    return out
end

local function dot(pos, color, size)
    local p = Instance.new("Part")
    p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch = true, false, false, false
    p.Material = Enum.Material.Neon
    p.Color = color or Color3.fromRGB(242, 182, 49)
    p.Shape = Enum.PartType.Ball
    p.Size = Vector3.new(size or 0.6, size or 0.6, size or 0.6)
    p.CFrame = CFrame.new(pos)
    p.Parent = trail
    return p
end

-- ---------- GUI ----------
local gui = Instance.new("ScreenGui")
gui.Name = "ZotacPathRecorder"
gui.ResetOnSpawn = false
gui.Parent = (gethui and gethui()) or game:GetService("CoreGui")
local frame = Instance.new("Frame")
frame.Size = UDim2.fromOffset(250, 214)
frame.Position = UDim2.fromOffset(20, 220)
frame.BackgroundColor3 = Color3.fromRGB(21, 17, 12)
frame.BorderSizePixel = 0
frame.Active, frame.Draggable = true, true
frame.Parent = gui
Instance.new("UICorner", frame).CornerRadius = UDim.new(0, 10)
local stroke = Instance.new("UIStroke", frame)
stroke.Color = Color3.fromRGB(242, 182, 49); stroke.Transparency = 0.5
local function label(text, y, h, size, color)
    local l = Instance.new("TextLabel")
    l.BackgroundTransparency = 1
    l.Size = UDim2.new(1, -20, 0, h)
    l.Position = UDim2.fromOffset(10, y)
    l.Font = Enum.Font.GothamBold
    l.TextSize = size
    l.TextColor3 = color or Color3.fromRGB(241, 233, 220)
    l.TextXAlignment = Enum.TextXAlignment.Left
    l.TextWrapped = true
    l.Text = text
    l.Parent = frame
    return l
end
label("ZOTAC PATH RECORDER", 8, 18, 13, Color3.fromRGB(242, 182, 49))
local status = label("Press Record, then walk the way a player would.", 28, 44, 11, Color3.fromRGB(190, 180, 165))
status.Font = Enum.Font.Gotham
local function button(text, x, y, w, color, fn)
    local b = Instance.new("TextButton")
    b.Size = UDim2.fromOffset(w, 30)
    b.Position = UDim2.fromOffset(x, y)
    b.BackgroundColor3 = color
    b.BorderSizePixel = 0
    b.Font = Enum.Font.GothamBold
    b.TextSize = 12
    b.TextColor3 = Color3.fromRGB(20, 16, 10)
    b.Text = text
    b.AutoButtonColor = true
    b.Parent = frame
    Instance.new("UICorner", b).CornerRadius = UDim.new(0, 6)
    table.insert(conns, b.Activated:Connect(fn))
    return b
end

local function setStatus(t) status.Text = t end
local function addPoint(pos, state, force)
    local last = rec.points[#rec.points]
    if not force and last and (Vector3.new(last.w[1], last.w[2], last.w[3]) - pos).Magnitude < STEP and last.st == state then return end
    local b, inside = plotAt(pos)
    table.insert(rec.points, {
        t = r1(os.clock() - rec.t0), w = v3(pos), st = state,
        plot = b and b.plot.Name or nil, inside = inside,
        rel = b and v3(b.pivot:PointToObjectSpace(pos)) or nil,
    })
    rec.plotsSeen = rec.plotsSeen or {}
    if b then rec.plotsSeen[b.plot.Name] = b end
    dot(pos, state == "Jumping" and Color3.fromRGB(80, 160, 255) or state == "Climbing" and Color3.fromRGB(170, 100, 255) or nil)
end

local function mark(kind)
    if not rec.running then setStatus("Press Record first."); return end
    local hrp = char()
    if not hrp then return end
    local pos = hrp.Position
    addPoint(pos, "Mark", true)
    local b, inside = plotAt(pos)
    local m = {kind = kind, i = #rec.points, w = v3(pos), plot = b and b.plot.Name or nil, inside = inside, rel = b and v3(b.pivot:PointToObjectSpace(pos)) or nil, sign = b and signOf(b.plot) or nil}
    if kind == "podium" and b then
        local pod, d = nearestPodium(b, pos)
        m.slot, m.dist = pod and pod.Name or nil, d and r1(d) or nil
    end
    table.insert(rec.marks, m)
    dot(pos, kind == "podium" and Color3.fromRGB(63, 207, 114) or Color3.fromRGB(255, 80, 80), 1.6)
    setStatus(("Marked %s%s (%d marks, %d points)"):format(kind, m.slot and (" slot " .. m.slot) or "", #rec.marks, #rec.points))
end

local function save()
    local plots = {}
    for name, b in pairs(rec.plotsSeen or {}) do
        local hit = b.plot:FindFirstChild("DeliveryHitbox", true)
        plots[name] = {
            pivot = {b.pivot:GetComponents()}, box = {b.cf:GetComponents()}, size = v3(b.size),
            sign = signOf(b.plot), podiums = podiumInfo(b),
            delivery = hit and hit:IsA("BasePart") and v3(b.pivot:PointToObjectSpace(hit.Position)) or nil,
        }
    end
    local data = {v = 1, by = LP.Name, placeId = game.PlaceId, at = os.time(), step = STEP, points = rec.points, marks = rec.marks, plots = plots}
    local json = HttpService:JSONEncode(data)
    local file = ("zotac_paths/path_%d.json"):format(os.time())
    local ok = pcall(function()
        if makefolder and not (isfolder and isfolder("zotac_paths")) then makefolder("zotac_paths") end
        writefile(file, json)
    end)
    if not ok then file = ("zotac_path_%d.json"):format(os.time()); ok = pcall(writefile, file, json) end
    setStatus(ok and ("Saved %s (%d points, %d marks). Tell Claude it is saved.") :format(file, #rec.points, #rec.marks) or "Could not save (writefile failed)")
end

button("● Record", 10, 78, 110, Color3.fromRGB(242, 182, 49), function()
    if rec.running then return end
    rec.points, rec.marks, rec.plotsSeen, rec.t0, rec.running = {}, {}, {}, os.clock(), true
    boxes = nil
    trail:ClearAllChildren()
    local hrp, hum = char()
    if hrp then addPoint(hrp.Position, hum and hum:GetState().Name or "?", true) end
    setStatus("Recording. Walk to the pet, stand where you would steal it, press Mark podium.")
end)
button("■ Stop + Save", 130, 78, 110, Color3.fromRGB(239, 68, 68), function()
    if not rec.running then setStatus("Nothing recorded yet."); return end
    rec.running = false
    save()
end)
button("Mark podium", 10, 114, 110, Color3.fromRGB(63, 207, 114), function() mark("podium") end)
button("Mark home", 130, 114, 110, Color3.fromRGB(120, 170, 255), function() mark("home") end)
button("Mark note", 10, 150, 110, Color3.fromRGB(200, 190, 175), function() mark("note") end)
button("Close", 130, 150, 110, Color3.fromRGB(90, 80, 70), function() _G.ZotacPathRec.Stop() end)
local hint = label("Podium = where you stand to steal. Home = your delivery spot. Note = anything else (stairs start, door...).", 184, 28, 9, Color3.fromRGB(150, 140, 125))
hint.Font = Enum.Font.Gotham

-- sampling: every STEP studs, and on every jump / climb / fall
table.insert(conns, RunService.Heartbeat:Connect(function()
    if not rec.running then return end
    local hrp, hum = char()
    if hrp then addPoint(hrp.Position, hum and hum:GetState().Name or "?", false) end
end))
local function hookHumanoid(c)
    local hum = c:WaitForChild("Humanoid", 10)
    if not hum then return end
    table.insert(conns, hum.StateChanged:Connect(function(_, new)
        if not rec.running then return end
        local hrp = c:FindFirstChild("HumanoidRootPart")
        if hrp then addPoint(hrp.Position, new.Name, true) end
    end))
end
if LP.Character then task.spawn(hookHumanoid, LP.Character) end
table.insert(conns, LP.CharacterAdded:Connect(hookHumanoid))

_G.ZotacPathRec = {
    Stop = function()
        for _, c in ipairs(conns) do pcall(function() c:Disconnect() end) end
        pcall(function() gui:Destroy() end)
        pcall(function() trail:Destroy() end)
    end,
    Data = rec,
}
