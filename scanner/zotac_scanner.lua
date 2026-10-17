if not game:IsLoaded() then game.Loaded:Wait() end
do local t0 = os.clock(); while game.PlaceId == 0 and os.clock() - t0 < 60 do task.wait(0.25) end end
if game.PlaceId ~= 109983668079237 then return end

local ZOTAC_PORT  = 47321
local ZOTAC_TOKEN = "PASTE_AGENT_TOKEN"
local SCAN_SERVER = true
local SHOW_GUI = true
local SYNC = false   -- true only in the autoexec copy Zotac installs: sends the base to Zotac. The copy you run by hand only copies JSON.

local Players     = game:GetService("Players")
local HttpService = game:GetService("HttpService")
local StarterGui  = game:GetService("StarterGui")
while not Players.LocalPlayer do task.wait(0.1) end
local LP = Players.LocalPlayer
local PG = LP:WaitForChild("PlayerGui")

if _G.ZotacScannerStop then pcall(_G.ZotacScannerStop) end
local running = true
local guiRoot = nil
_G.ZotacScannerStop = function() running = false; if guiRoot then pcall(function() guiRoot:Destroy() end) end end

local function notify(text)
    pcall(StarterGui.SetCore, StarterGui, "SendNotification", {Title = "Zotac Scanner", Text = text, Duration = 5})
    print("[Zotac] " .. text)
end

local SUFFIX = {K = 1e3, M = 1e6, B = 1e9, T = 1e12, Qa = 1e15, Qi = 1e18}
local function parseMoney(text)
    local num, suf = tostring(text):gsub("<[^>]->", ""):match("([%d%.]+)%s*(%a*)")
    if not num or not tonumber(num) then return nil end
    return tonumber(num) * (SUFFIX[suf] or 1)
end
local function stripTags(s) return (tostring(s):gsub("<[^>]->", "")) end

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

local function isPet(inst)
    return inst:IsA("Model") and inst:GetAttribute("__AssetDescendantCount") ~= nil
end

-- every brainrot has its own uuid: read from the plot cache entry or the pet model's attributes
-- (only reading what the client already has), so Zotac knows "same pet" from "new identical pet"
local UUID_KEYS = {"UUID", "Uuid", "uuid", "AnimalUUID", "AnimalUuid", "AnimalId", "Guid", "GUID", "Id", "ID", "id"}
local function normUuid(v)
    if type(v) ~= "string" then return nil end
    local s = string.lower((v:gsub("[{}]", "")))
    if s:match("^%x%x%x%x%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%x%x%x%x%x%x%x%x$") then return s end
    return nil
end
local function uuidOf(entry, key)
    if type(entry) == "table" then
        for _, k in ipairs(UUID_KEYS) do
            local ok, v = pcall(rawget, entry, k)
            local u = ok and normUuid(v)
            if u then return u, k end
        end
        local okP, u2, k2 = pcall(function()
            for k, v in pairs(entry) do local u = normUuid(v); if u then return u, tostring(k) end end
        end)
        if okP and u2 then return u2, k2 end
    end
    local u = normUuid(key)
    if u then return u, "list key" end
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
local function entrySlot(a, key)
    for _, k in ipairs({"Slot", "slot", "PodiumIndex", "Podium"}) do
        local ok, v = pcall(rawget, a, k)
        if ok and (type(v) == "number" or type(v) == "string") then return tostring(v) end
    end
    if type(key) == "number" then return tostring(key) end
    return nil
end
local function podiumSlot(podiums, pos)
    local best, bestD = nil, 15
    for _, pod in ipairs(podiums and podiums:GetChildren() or {}) do
        local ok, cf = pcall(function() return pod:GetPivot() end)
        if ok then
            local d = Vector2.new(cf.Position.X - pos.X, cf.Position.Z - pos.Z).Magnitude
            if d < bestD then best, bestD = pod.Name, d end
        end
    end
    return best
end
-- the plot cache entry of one pet model: same uuid, else same podium slot, else same name +
-- mutation, else same name (each entry used once)
local function takeEntry(entries, name, uuid, slot, mut)
    local function take(i) local e = entries[i]; table.remove(entries, i); return e end
    if uuid then for i, e in ipairs(entries) do if e.uuid == uuid then return take(i) end end end
    if slot then for i, e in ipairs(entries) do if e.slot == slot and e.a.Index == name then return take(i) end end end
    if mut then for i, e in ipairs(entries) do if e.a.Index == name and tostring(e.a.Mutation or "None") == tostring(mut) then return take(i) end end end
    for i, e in ipairs(entries) do if e.a.Index == name then return take(i) end end
    return nil
end

local function readOverheads()
    local list = {}
    local debris = workspace:FindFirstChild("Debris")
    if not debris then return list end
    for _, part in ipairs(debris:GetChildren()) do
        local gui = part:IsA("BasePart") and part:FindFirstChild("AnimalOverhead")
        local nameLabel = gui and gui:FindFirstChild("DisplayName")
        if nameLabel then table.insert(list, {part = part, gui = gui, name = stripTags(nameLabel.Text)}) end
    end
    return list
end
local function nearestOverhead(overheads, name, pos, used)
    local best, bestDist = nil, 12
    for _, o in ipairs(overheads) do
        if o.name == name and not used[o] then
            local p = o.part.Position
            local d = Vector2.new(p.X - pos.X, p.Z - pos.Z).Magnitude
            if d < bestDist then best, bestDist = o, d end
        end
    end
    if best then used[best] = true end
    return best
end

local plotCacheMap, plotCacheAt = nil, 0
local function plotCaches()
    if plotCacheMap and os.clock() - plotCacheAt < 20 then return plotCacheMap end
    plotCacheMap, plotCacheAt = {}, os.clock()
    if not getgc then return plotCacheMap end
    local ok, gc = pcall(getgc, true)
    if not ok then return plotCacheMap end
    for _, v in ipairs(gc) do
        if type(v) == "table" then
            local oi, idx = pcall(rawget, v, "Index")
            if oi and type(idx) == "string" then
                local oc, ct = pcall(rawget, v, "CacheTable")
                if oc and type(ct) == "table" and not plotCacheMap[idx] then plotCacheMap[idx] = ct end
            end
        end
    end
    return plotCacheMap
end
local function plotAnimalList(plotName)
    local ct = plotCaches()[plotName]
    if not ct and os.clock() - plotCacheAt > 2 then plotCacheMap = nil; ct = plotCaches()[plotName] end
    if not ct then return nil end
    local ok, list = pcall(function() return ct.AnimalList end)
    return ok and type(list) == "table" and list or nil
end

local function ownerInfo(plot)
    local ct = plotCaches()[plot.Name]
    if ct then
        local ok, owner = pcall(function() return ct.Owner end)
        if ok and owner ~= nil then
            local pl
            if typeof(owner) == "Instance" and owner:IsA("Player") then pl = owner
            elseif type(owner) == "number" then pl = Players:GetPlayerByUserId(owner)
            elseif type(owner) == "string" then pl = Players:FindFirstChild(owner)
            elseif type(owner) == "table" then
                local id = rawget(owner, "UserId") or rawget(owner, "userId")
                local nm = rawget(owner, "Name") or rawget(owner, "name")
                pl = (type(id) == "number" and Players:GetPlayerByUserId(id)) or (type(nm) == "string" and Players:FindFirstChild(nm)) or nil
                if not pl and nm then return tostring(nm), tostring(nm), id end
            end
            if pl then return pl.Name, pl.DisplayName, pl.UserId end
        end
    end
    local sign = plot:FindFirstChild("PlotSign")
    for _, d in ipairs(sign and sign:GetDescendants() or {}) do
        if d:IsA("TextLabel") then
            if d.Text == "YOUR BASE" then
                local gui = d:FindFirstAncestorWhichIsA("LayerCollector")
                if gui and gui.Enabled then return LP.Name, LP.DisplayName, LP.UserId end
            end
            local who = stripTags(d.Text):match("^(.-)'s [Bb]ase$")
            if who and who ~= "" then
                for _, pl in ipairs(Players:GetPlayers()) do
                    if pl.DisplayName == who or pl.Name == who then return pl.Name, pl.DisplayName, pl.UserId end
                end
                return who, who, nil
            end
        end
    end
    return nil
end

local function traitList(t)
    local out = {}
    if type(t) == "table" then
        for k, v in pairs(t) do
            if type(v) == "string" then table.insert(out, v)
            elseif type(k) == "string" and v then table.insert(out, k) end
        end
    elseif type(t) == "string" and t ~= "" then
        table.insert(out, t)
    end
    table.sort(out)
    return out
end

local RS = game:GetService("ReplicatedStorage")
local function loadData(name)
    local d = RS:FindFirstChild("Datas")
    local m = d and d:FindFirstChild(name)
    if not (m and m:IsA("ModuleScript")) then return {} end
    local ok, t = pcall(require, m)
    return ok and type(t) == "table" and t or {}
end
local ANIMALS, TRAITS, MUTATIONS, RNGIMG
local function imageIdOf(v)
    if type(v) == "number" and v > 1000 then return tostring(math.floor(v)) end
    if type(v) ~= "string" then return nil end
    return v:match("rbxassetid://(%d+)") or v:match("[?&]id=(%d+)") or (v:match("^%d+$") and #v > 5 and v) or nil
end

local function imageField(t, depth)
    depth = depth or 0
    if type(t) ~= "table" or depth > 3 then return nil end
    for _, k in ipairs({"Icon", "Image", "Thumbnail", "ImageId", "IconId", "Picture", "Decal", "Texture"}) do
        local okv, v = pcall(rawget, t, k)
        local id = okv and imageIdOf(v)
        if id then return id end
    end
    local later = {}
    for k, v in pairs(t) do
        local lk = type(k) == "string" and string.lower(k) or ""
        if string.find(lk, "image") or string.find(lk, "icon") or string.find(lk, "thumb") then
            local id = imageIdOf(v) or imageField(v, depth + 1)
            if id then return id end
        elseif type(v) == "table" then
            table.insert(later, v)
        elseif type(v) == "string" and string.find(v, "rbxassetid://", 1, true) then
            local id = imageIdOf(v)
            if id then return id end
        end
    end
    for _, v in ipairs(later) do
        local id = imageField(v, depth + 1)
        if id then return id end
    end
    return nil
end

local function shapeOf(t)
    local out = {}
    if type(t) ~= "table" then return tostring(type(t)) end
    local n = 0
    for k, v in pairs(t) do
        n += 1
        if n > 25 then break end
        local val = type(v)
        if type(v) == "string" or type(v) == "number" or type(v) == "boolean" then val = val .. ":" .. string.sub(tostring(v), 1, 60)
        elseif typeof(v) == "Instance" then val = "Instance:" .. v.ClassName .. ":" .. v.Name end
        out[tostring(k)] = val
    end
    return out
end

local ICON2TRAIT
local function overheadTraits(o)
    if not o then return nil end
    if not ICON2TRAIT then
        ICON2TRAIT = {}
        TRAITS = TRAITS or loadData("Traits")
        for name, entry in pairs(TRAITS) do
            local id = imageField(entry)
            if id and type(name) == "string" then ICON2TRAIT[id] = name end
        end
    end
    local frame = o.gui:FindFirstChild("Traits")
    if not frame then return nil end
    local out = {}
    for _, d in ipairs(frame:GetChildren()) do
        if (d:IsA("ImageLabel") or d:IsA("ImageButton")) and d.Visible and d.Image ~= "" then
            local name = ICON2TRAIT[imageIdOf(d.Image) or ""]
            if name then table.insert(out, name) end
        end
    end
    table.sort(out)
    return out
end

local function collectArt(pets)
    ANIMALS = ANIMALS or loadData("Animals")
    TRAITS = TRAITS or loadData("Traits")
    MUTATIONS = MUTATIONS or loadData("Mutations")
    local art = {pets = {}, traits = {}, mutations = {}, shape = {}}
    local wantPet, wantTrait, wantMut = {}, {}, {}
    for _, p in ipairs(pets) do
        wantPet[p.name] = true
        for _, t in ipairs(p.traits) do wantTrait[t] = true end
        if p.mutation and p.mutation ~= "None" and p.mutation ~= "Normal" then wantMut[p.mutation] = true end
    end

    RNGIMG = RNGIMG or loadData("RNGMachineLimitedStockData")
    for name in pairs(wantPet) do
        art.pets[name] = imageIdOf(type(RNGIMG.ImageIds) == "table" and RNGIMG.ImageIds[name]) or imageField(ANIMALS[name])
    end
    for name in pairs(wantTrait) do art.traits[name] = imageField(TRAITS[name]) end
    for name in pairs(wantMut) do art.mutations[name] = imageField(MUTATIONS[name]) end

    if not _G.ZotacAllIconsSent then
        for name, entry in pairs(TRAITS) do
            if type(name) == "string" and not art.traits[name] then art.traits[name] = imageField(entry) end
        end
        for name, entry in pairs(MUTATIONS) do
            if type(name) == "string" and not art.mutations[name] then art.mutations[name] = imageField(entry) end
        end
        art.allIcons = true
    end

    for name in pairs(wantTrait) do if not art.traits[name] then art.shape.trait = {name = name, entry = shapeOf(TRAITS[name])} break end end
    for name in pairs(wantMut) do if not art.mutations[name] then art.shape.mutation = {name = name, entry = shapeOf(MUTATIONS[name])} break end end
    for name in pairs(wantPet) do if not art.pets[name] then art.shape.pet = {name = name, entry = shapeOf(ANIMALS[name])} break end end

    local missing = false
    for name in pairs(wantPet) do if not art.pets[name] then missing = true end end
    for name in pairs(wantTrait) do if not art.traits[name] then missing = true end end
    for name in pairs(wantMut) do if not art.mutations[name] then missing = true end end
    if missing then

        local lowerWant = {}
        for name in pairs(wantPet) do lowerWant[string.lower(name)] = name end
        local function petFromText(txt)
            local t = string.lower(stripTags(txt or ""))
            if lowerWant[t] then return lowerWant[t] end
            for lw, name in pairs(lowerWant) do
                if #t > #lw and string.sub(t, -#lw - 1) == " " .. lw then return name end
            end
            return nil
        end
        local learned = {}
        if isfile and readfile and isfile("zotac_art.json") then
            local ok, t = pcall(function() return HttpService:JSONDecode(readfile("zotac_art.json")) end)
            if ok and type(t) == "table" then learned = t end
        end
        local function look(d)
            if not ((d:IsA("ImageLabel") or d:IsA("ImageButton")) and d.Image ~= "") then return end
            if d:FindFirstAncestor("AnimalOverhead") then return end
            local id = imageIdOf(d.Image)
            if not id then return end
            if wantTrait[d.Name] and not art.traits[d.Name] then art.traits[d.Name] = id end
            if wantMut[d.Name] and not art.mutations[d.Name] then art.mutations[d.Name] = id end
            local anc = d.Parent
            for _ = 1, 2 do
                if not anc then break end
                local n = 0
                for _, tl in ipairs(anc:GetDescendants()) do
                    n += 1
                    if n > 60 then break end
                    if tl:IsA("TextLabel") or tl:IsA("TextButton") then
                        local pet = petFromText(tl.Text)
                        if pet then if not learned[pet] then learned[pet] = id end; return end
                    end
                end
                anc = anc.Parent
            end
        end
        for _, d in ipairs(PG:GetDescendants()) do look(d) end

        for _, d in ipairs(RS:GetDescendants()) do
            local pet = lowerWant[string.lower(d.Name)]
            if pet and not learned[pet] then
                local okI, img = pcall(function() return d.Image end)
                local okT, tex = pcall(function() return d.Texture end)
                local id = (okI and imageIdOf(img)) or (okT and imageIdOf(tex))
                if id then learned[pet] = id end
            end
        end

        local users = {}
        for pet, id in pairs(learned) do users[id] = (users[id] or 0) + 1 end
        for pet, id in pairs(learned) do if users[id] > 1 then learned[pet] = nil end end
        if writefile then pcall(writefile, "zotac_art.json", HttpService:JSONEncode(learned)) end
        for name in pairs(wantPet) do
            if not art.pets[name] and learned[name] then art.pets[name] = learned[name] end
        end
    end
    return art
end

local function assetId(v)
    if type(v) ~= "string" then return nil end
    return v:match("rbxassetid://(%d+)") or v:match("[?&]id=(%d+)") or (v:match("^%d+$") and v) or nil
end
local function round(n) return math.floor(n * 1000 + 0.5) / 1000 end

local function serializeModel(model, poseFrom)
    local pivot = model:GetPivot()
    local livePivot, live = poseFrom and poseFrom:GetPivot(), {}
    if poseFrom then
        for _, d in ipairs(poseFrom:GetDescendants()) do
            if d:IsA("BasePart") then live[d:GetFullName():sub(#poseFrom:GetFullName() + 2)] = d end
        end
    end
    local parts = {}
    for _, d in ipairs(model:GetDescendants()) do
        if d:IsA("BasePart") and d.Transparency < 0.99 and #parts < 200 then
            local twin = live[d:GetFullName():sub(#model:GetFullName() + 2)]
            local rel = twin and livePivot:ToObjectSpace(twin.CFrame) or pivot:ToObjectSpace(d.CFrame)
            local cf = {rel:GetComponents()}
            for i = 1, 12 do cf[i] = round(cf[i]) end

            local top = d
            while top.Parent and top.Parent ~= model do top = top.Parent end
            local part = {
                group = top ~= d and top.Name or nil,
                cls = d.ClassName, size = {round(d.Size.X), round(d.Size.Y), round(d.Size.Z)}, cf = cf,
                color = d.Color:ToHex(), transparency = round(d.Transparency), material = d.Material.Name,
            }
            if d:IsA("MeshPart") then
                part.mesh = assetId(d.MeshId)
                part.texture = assetId(d.TextureID)
            end
            if d:IsA("Part") then part.shape = d.Shape.Name end
            local sa = d:FindFirstChildOfClass("SurfaceAppearance")
            if sa then
                local ok, cm = pcall(function() return sa.ColorMap end)
                if ok then part.texture = assetId(cm) or part.texture end
            end
            local sm = d:FindFirstChildOfClass("SpecialMesh")
            if sm then
                part.special = {
                    type = sm.MeshType.Name, mesh = assetId(sm.MeshId), texture = assetId(sm.TextureId),
                    scale = {round(sm.Scale.X), round(sm.Scale.Y), round(sm.Scale.Z)},
                    offset = {round(sm.Offset.X), round(sm.Offset.Y), round(sm.Offset.Z)},
                }
            end
            local decals = {}
            for _, x in ipairs(d:GetChildren()) do
                if x:IsA("Decal") and x.Transparency < 0.99 then
                    table.insert(decals, {face = x.Face.Name, texture = assetId(x.Texture)})
                end
            end
            if #decals > 0 then part.decals = decals end
            table.insert(parts, part)
        end
    end

    local bones = {}
    local src = poseFrom or model
    local bp = poseFrom and livePivot or pivot
    for _, b in ipairs(src:GetDescendants()) do
        if b:IsA("Bone") and not bones[b.Name] then
            local rest = {bp:ToObjectSpace(b.WorldCFrame):GetComponents()}
            local pose = {bp:ToObjectSpace(b.TransformedWorldCFrame):GetComponents()}
            for i = 1, 12 do rest[i] = round(rest[i]); pose[i] = round(pose[i]) end
            bones[b.Name] = {rest = rest, pose = pose}
        end
    end
    return {parts = parts, bones = bones}
end
local modelsSent = {}
local modelsOut = nil

local function readPlot(plot, overheads, used, withModels)
    local entries, info = {}, {}
    local animals = plotAnimalList(plot.Name)
    if animals then
        for k, a in pairs(animals) do
            if type(a) == "table" and type(a.Index) == "string" then
                local u, from = uuidOf(a, k)
                if u and not info.uuidFrom then info.uuidFrom = from end
                if not info.entryKeys then   -- field names + types only (shows where the uuid lives)
                    local names = {}
                    pcall(function() for kk, vv in pairs(a) do table.insert(names, tostring(kk) .. ":" .. type(vv)) end end)
                    table.sort(names)
                    info.entryKeys = table.concat(names, ",")
                    info.listKey = type(k)
                end
                table.insert(entries, {a = a, key = k, uuid = u, slot = entrySlot(a, k)})
            end
        end
    end
    local podiums = plot:FindFirstChild("AnimalPodiums")

    local pets = {}
    for _, c in ipairs(plot:GetChildren()) do
        if isPet(c) then
            local pos = c:GetPivot().Position
            local o = nearestOverhead(overheads, c.Name, pos, used)
            local genL = o and o.gui:FindFirstChild("Generation")
            local rarL = o and o.gui:FindFirstChild("Rarity")
            local mu, mFrom = modelUuid(c)
            if mu and not info.uuidFrom then info.uuidFrom = mFrom end
            if not info.modelAttrs then
                local names = {}
                pcall(function() for kk in pairs(c:GetAttributes()) do table.insert(names, tostring(kk)) end end)
                table.sort(names)
                info.modelAttrs = table.concat(names, ",")
            end
            local e = takeEntry(entries, c.Name, mu, podiumSlot(podiums, pos), c:GetAttribute("Mutation"))
            local a = e and e.a
            local uuid = mu or (e and e.uuid) or nil
            if uuid then info.withUuid = (info.withUuid or 0) + 1 end
            local mutation = c:GetAttribute("Mutation") or (a and a.Mutation) or "None"

            local cache = RS:FindFirstChild("Controllers") and RS.Controllers:FindFirstChild("AssetStreamController")
            cache = cache and cache:FindFirstChild("AssetCache")
            local base = cache and cache:FindFirstChild(c.Name)
            local key = c.Name .. "|" .. (base and "None" or tostring(mutation))
            if withModels and not modelsSent[key] then
                local okM, m = pcall(serializeModel, base or c, base and c or nil)
                if okM and #m.parts > 0 then
                    modelsOut = modelsOut or {}
                    modelsOut[key] = m
                end
            end
            table.insert(pets, {
                name     = c.Name,
                uuid     = uuid,
                mutation = tostring(mutation),
                gen      = genL and parseMoney(genL.Text) or 0,
                rarity   = rarL and stripTags(rarL.Text) or nil,
                traits   = (function()
                    local fromTag = overheadTraits(o)
                    if fromTag and #fromTag > 0 then return fromTag end
                    return traitList(a and a.Traits)
                end)(),
            })
        end
    end
    table.sort(pets, function(x, y) return (x.gen or 0) > (y.gen or 0) end)
    return pets, animals, info
end

local function scan()
    local plot = findMyPlot()
    if not plot then
        local plots = workspace:FindFirstChild("Plots")
        return nil, ("Base not found (plots loaded: %d, getgc: %s) - stand in your base and run again")
            :format(plots and #plots:GetChildren() or 0, getgc and "yes" or "no")
    end
    local overheads = readOverheads()
    modelsOut = nil
    local pets, animals, info = readPlot(plot, overheads, {}, true)
    local expected = nil
    if animals then expected = 0; for _, a in pairs(animals) do if type(a) == "table" and type(a.Index) == "string" then expected += 1 end end end
    return {expected = expected, username = LP.Name, userId = LP.UserId, displayName = LP.DisplayName, scannedAt = os.time(), pets = pets, traitsKnown = animals ~= nil or #overheads > 0, uuidInfo = info}
end

local httpRequest = (syn and syn.request) or (http and http.request) or http_request or request
local function post(path, payload)
    if not httpRequest or ZOTAC_TOKEN == "" or ZOTAC_TOKEN == "PASTE_AGENT_TOKEN" then return false, "no token / no request()" end
    local ok, res = pcall(httpRequest, {
        Url = "http://127.0.0.1:" .. ZOTAC_PORT .. path,
        Method = "POST",
        Headers = {["Content-Type"] = "application/json", ["X-Zotac-Token"] = ZOTAC_TOKEN},
        Body = HttpService:JSONEncode(payload),
    })
    if not ok then return false, tostring(res) end
    if res.StatusCode ~= 200 then return false, "HTTP " .. tostring(res.StatusCode) .. " " .. tostring(res.Body) end
    return true, res.Body
end
local function send(payload) return post("/scanner/import", payload) end

local function signature(data)
    local parts = {}
    for _, p in ipairs(data.pets) do
        table.insert(parts, p.name .. "|" .. p.mutation .. "|" .. tostring(p.gen) .. "|" .. table.concat(p.traits, ","))
    end
    return table.concat(parts, ";")
end

local function heartbeat()
    if not httpRequest or ZOTAC_TOKEN == "PASTE_AGENT_TOKEN" then return end
    pcall(httpRequest, {
        Url = "http://127.0.0.1:" .. ZOTAC_PORT .. "/agent/heartbeat",
        Method = "POST",
        Headers = {["Content-Type"] = "application/json", ["X-Zotac-Token"] = ZOTAC_TOKEN},
        Body = HttpService:JSONEncode({account = LP.Name}),
    })
end

local lastSig
local function runOnce(first)
    local data, err = scan()
    if not data then if first then notify(err) end return end
    local sig = signature(data)
    if sig == lastSig then return end
    lastSig = sig
    local models = modelsOut
    local json = HttpService:JSONEncode(data)
    if not SYNC then
        if setclipboard then pcall(setclipboard, json); notify(#data.pets .. " pets copied - paste the JSON into Zotac Auto List")
        else notify("This executor has no setclipboard") end
        return
    end
    local ok, why = send(data)
    if ok then
        notify(#data.pets .. " pets sent to Zotac")
    elseif first then
        notify(#data.pets .. " pets copied - paste into Zotac Auto List (" .. why .. ")")
        return
    end
    -- pictures, trait icons and 3D data are slower to collect: they follow without holding up the pets
    task.spawn(function()
        local okA, art = pcall(collectArt, data.pets)
        if not okA then art = nil end
        if models then art = art or {}; art.models = models end
        if not art then return end
        local ok2 = post("/scanner/art", {username = data.username, art = art})
        if ok2 then
            for k in pairs(art.models or {}) do modelsSent[k] = true end
            if art.allIcons then _G.ZotacAllIconsSent = true end
        end
    end)
end

local function scanServer(includeEmpty)
    local plots = workspace:FindFirstChild("Plots")
    if not plots then return nil end
    local overheads, used = readOverheads(), {}
    local mine = ownPlotName and plots:FindFirstChild(ownPlotName)
    local bases = {}
    for _, plot in ipairs(plots:GetChildren()) do
        local okR, pets = pcall(readPlot, plot, overheads, used, false)
        if not okR or type(pets) ~= "table" then pets = {} end
        local name, display, uid = ownerInfo(plot)
        if includeEmpty or name or #pets > 0 then
            local total = 0
            for _, p in ipairs(pets) do total += (p.gen or 0) end
            table.insert(bases, {plot = plot.Name, owner = name, displayName = display, userId = uid, mine = plot == mine or uid == LP.UserId, pets = pets, totalGen = total, empty = not name and #pets == 0})
        end
    end
    table.sort(bases, function(a, b)
        if a.empty ~= b.empty then return not a.empty end
        return a.totalGen > b.totalGen
    end)
    return {jobId = game.JobId, placeId = game.PlaceId, by = LP.Name, players = #Players:GetPlayers(), scannedAt = os.time(), bases = bases}
end

local lastServerSig, lastServerAt = nil, 0
local function runServer(force, data)
    if not SCAN_SERVER or not SYNC then return end
    data = data or scanServer(false)
    if not data then return end
    local kept = {}
    for _, b in ipairs(data.bases) do if not b.empty then table.insert(kept, b) end end
    data = {jobId = data.jobId, placeId = data.placeId, by = data.by, players = data.players, scannedAt = data.scannedAt, bases = kept}
    local parts = {}
    for _, b in ipairs(data.bases) do table.insert(parts, b.plot .. "=" .. tostring(b.owner) .. ":" .. signature(b)) end
    local sig = table.concat(parts, "#")
    if not force and sig == lastServerSig and os.clock() - lastServerAt < 120 then return end
    local ok = post("/scanner/server", data)
    if ok then lastServerSig, lastServerAt = sig, os.clock() end
end


local function buildGui()
    local TweenService = game:GetService("TweenService")
    local UIS = game:GetService("UserInputService")
    local YELLOW = Color3.fromRGB(245, 196, 0)
    local BG = Color3.fromRGB(20, 20, 24)
    local PANEL = Color3.fromRGB(26, 26, 31)
    local ROW = Color3.fromRGB(32, 32, 38)
    local OFF = Color3.fromRGB(52, 52, 60)
    local TEXT = Color3.fromRGB(240, 240, 245)
    local DIM = Color3.fromRGB(130, 130, 140)

    local function new(class, props, children)
        local o = Instance.new(class)
        for k, v in pairs(props or {}) do o[k] = v end
        for _, c in ipairs(children or {}) do c.Parent = o end
        return o
    end
    local function corner(r) return new("UICorner", {CornerRadius = UDim.new(0, r)}) end

    local parent
    local okH, hui = pcall(function() return gethui and gethui() end)
    if okH and hui then parent = hui else
        local okC, cg = pcall(function() return game:GetService("CoreGui") end)
        parent = okC and cg or PG
    end
    local old = parent:FindFirstChild("ZotacScannerGui")
    if old then old:Destroy() end

    local gui = new("ScreenGui", {Name = "ZotacScannerGui", ResetOnSpawn = false, ZIndexBehavior = Enum.ZIndexBehavior.Sibling, DisplayOrder = 50})
    pcall(function() gui.Parent = parent end)
    if not gui.Parent then gui.Parent = PG end
    guiRoot = gui

    local main = new("Frame", {Parent = gui, Size = UDim2.fromOffset(600, 380), Position = UDim2.new(0.5, -300, 0.5, -190), BackgroundColor3 = BG, BorderSizePixel = 0, Active = true},
        {corner(16), new("UIStroke", {Color = YELLOW, Thickness = 2})})

    local left = new("Frame", {Parent = main, Size = UDim2.new(0, 200, 1, 0), BackgroundColor3 = PANEL, BorderSizePixel = 0}, {corner(16)})
    new("Frame", {Parent = left, Size = UDim2.new(0, 16, 1, 0), Position = UDim2.new(1, -16, 0, 0), BackgroundColor3 = PANEL, BorderSizePixel = 0})
    local logoBox = new("Frame", {Parent = left, Size = UDim2.fromOffset(116, 116), Position = UDim2.new(0.5, -58, 0, 22), BackgroundColor3 = ROW},
        {corner(16), new("UIStroke", {Color = YELLOW, Thickness = 2})})
    local face = new("Frame", {Parent = logoBox, Size = UDim2.fromScale(0.8, 0.8), Position = UDim2.fromScale(0.5, 0.5), AnchorPoint = Vector2.new(0.5, 0.5),
        BackgroundColor3 = Color3.fromRGB(242, 182, 49), BorderSizePixel = 0}, {new("UICorner", {CornerRadius = UDim.new(0.5, 0)})})
    for _, dot in ipairs({{0.358, 0.458, 0.175}, {0.642, 0.458, 0.175}, {0.5, 0.633, 0.083}}) do
        new("Frame", {Parent = face, Size = UDim2.fromScale(dot[3], dot[3]), Position = UDim2.fromScale(dot[1], dot[2]), AnchorPoint = Vector2.new(0.5, 0.5),
            BackgroundColor3 = Color3.fromRGB(12, 11, 8), BorderSizePixel = 0}, {new("UICorner", {CornerRadius = UDim.new(0.5, 0)})})
    end
    new("TextLabel", {Parent = left, Size = UDim2.new(1, 0, 0, 26), Position = UDim2.fromOffset(0, 148), BackgroundTransparency = 1, RichText = true,
        Text = 'Zotac <font color="#F5C400">Lister</font>', Font = Enum.Font.GothamBold, TextSize = 20, TextColor3 = TEXT})
    local stats = new("TextLabel", {Parent = left, Size = UDim2.new(1, 0, 0, 16), Position = UDim2.fromOffset(0, 176), BackgroundTransparency = 1,
        Text = "scanning...", Font = Enum.Font.Gotham, TextSize = 11, TextColor3 = DIM})

    local function button(text, y, primary)
        return new("TextButton", {Parent = left, Size = UDim2.new(1, -28, 0, 32), Position = UDim2.new(0, 14, 1, y), AutoButtonColor = true,
            BackgroundColor3 = primary and YELLOW or ROW, Text = text, Font = Enum.Font.GothamBold, TextSize = 13,
            TextColor3 = primary and Color3.fromRGB(20, 20, 20) or TEXT, BorderSizePixel = 0}, {corner(8)})
    end
    local refreshBtn = button("Refresh", -132, false)
    local allBtn = button("Select All", -92, false)
    local copyBtn = button("Copy Selected", -52, true)

    new("TextLabel", {Parent = main, Size = UDim2.fromOffset(120, 16), Position = UDim2.fromOffset(216, 16), BackgroundTransparency = 1,
        Text = "BASES", Font = Enum.Font.GothamBold, TextSize = 11, TextColor3 = DIM, TextXAlignment = Enum.TextXAlignment.Left})
    new("TextLabel", {Parent = main, Size = UDim2.fromOffset(60, 16), Position = UDim2.new(1, -96, 0, 16), BackgroundTransparency = 1,
        Text = "PETS", Font = Enum.Font.GothamBold, TextSize = 11, TextColor3 = DIM, TextXAlignment = Enum.TextXAlignment.Right})
    local close = new("TextButton", {Parent = main, Size = UDim2.fromOffset(22, 22), Position = UDim2.new(1, -30, 0, 10), BackgroundTransparency = 1,
        Text = "X", Font = Enum.Font.GothamBold, TextSize = 13, TextColor3 = DIM})

    local list = new("ScrollingFrame", {Parent = main, Size = UDim2.new(1, -228, 1, -56), Position = UDim2.fromOffset(212, 40), BackgroundTransparency = 1,
        BorderSizePixel = 0, ScrollBarThickness = 4, ScrollBarImageColor3 = YELLOW, CanvasSize = UDim2.new(), AutomaticCanvasSize = Enum.AutomaticSize.Y},
        {new("UIListLayout", {Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder}), new("UIPadding", {PaddingRight = UDim.new(0, 8)})})

    local selected, current = {}, {}
    local function setToggle(t, on)
        TweenService:Create(t, TweenInfo.new(0.15), {BackgroundColor3 = on and YELLOW or OFF}):Play()
        TweenService:Create(t.Knob, TweenInfo.new(0.15), {Position = on and UDim2.new(1, -18, 0.5, -8) or UDim2.new(0, 2, 0.5, -8),
            BackgroundColor3 = on and Color3.fromRGB(20, 20, 20) or Color3.fromRGB(150, 150, 158)}):Play()
    end

    local function draw(data)
        for _, c in ipairs(list:GetChildren()) do if c:IsA("Frame") then c:Destroy() end end
        current = data and data.bases or {}
        local nb, np = 0, 0
        for i, b in ipairs(current) do
            if not b.empty then nb += 1; np += #b.pets end
            local who = b.empty and "Empty Base" or ((b.displayName and b.displayName ~= b.owner) and (b.displayName .. " (@" .. tostring(b.owner) .. ")") or tostring(b.owner or "Unknown"))
            if b.mine then who = who .. "  (you)" end
            local row = new("Frame", {Parent = list, Size = UDim2.new(1, 0, 0, 42), BackgroundColor3 = ROW, BorderSizePixel = 0, LayoutOrder = i}, {corner(10)})
            local tog = new("TextButton", {Name = "Toggle", Parent = row, Size = UDim2.fromOffset(38, 20), Position = UDim2.new(0, 12, 0.5, -10),
                BackgroundColor3 = OFF, Text = "", AutoButtonColor = false, BorderSizePixel = 0}, {corner(10)})
            new("Frame", {Name = "Knob", Parent = tog, Size = UDim2.fromOffset(16, 16), Position = UDim2.new(0, 2, 0.5, -8), BackgroundColor3 = Color3.fromRGB(150, 150, 158), BorderSizePixel = 0}, {corner(8)})
            local best = (not b.empty and b.pets[1]) and ("  ·  best " .. b.pets[1].name) or ""
            new("TextLabel", {Parent = row, Size = UDim2.new(1, -130, 1, 0), Position = UDim2.fromOffset(62, 0), BackgroundTransparency = 1,
                Text = who .. best, Font = b.empty and Enum.Font.Gotham or Enum.Font.GothamMedium, TextSize = 13,
                TextColor3 = b.empty and DIM or TEXT, TextXAlignment = Enum.TextXAlignment.Left, TextTruncate = Enum.TextTruncate.AtEnd})
            new("TextLabel", {Parent = row, Size = UDim2.fromOffset(34, 22), Position = UDim2.new(1, -46, 0.5, -11), BackgroundColor3 = BG,
                Text = tostring(#b.pets), Font = Enum.Font.GothamBold, TextSize = 12, TextColor3 = #b.pets > 0 and TEXT or DIM}, {corner(11)})
            if selected[b.plot] then setToggle(tog, true) end
            tog.MouseButton1Click:Connect(function()
                selected[b.plot] = not selected[b.plot] or nil
                setToggle(tog, selected[b.plot] == true)
            end)
        end
        stats.Text = ("%d bases · %d pets"):format(nb, np)
    end

    local busy = false
    local function refresh()
        if busy then return end
        busy = true
        refreshBtn.Text = "Scanning..."
        task.spawn(function()
            local ok, data = pcall(scanServer, true)
            if ok and data then
                draw(data)
                pcall(runServer, true, data)
            else
                stats.Text = "scan failed"
            end
            refreshBtn.Text = "Refresh"
            busy = false
        end)
    end

    refreshBtn.MouseButton1Click:Connect(refresh)
    allBtn.MouseButton1Click:Connect(function()
        local all = true
        for _, b in ipairs(current) do if not b.empty and not selected[b.plot] then all = false end end
        for _, b in ipairs(current) do if not b.empty then selected[b.plot] = (not all) or nil end end
        for _, row in ipairs(list:GetChildren()) do
            if row:IsA("Frame") then
                local b = current[row.LayoutOrder]
                if b then setToggle(row.Toggle, selected[b.plot] == true) end
            end
        end
        allBtn.Text = all and "Select All" or "Deselect All"
    end)
    copyBtn.MouseButton1Click:Connect(function()
        local out, nb, np = {}, 0, 0
        for _, b in ipairs(current) do
            if selected[b.plot] and not b.empty then
                nb += 1; np += #b.pets
                table.insert(out, {username = b.owner or b.plot, displayName = b.displayName, userId = b.userId, pets = b.pets})
            end
        end
        if nb == 0 then notify("Select at least one base first") return end
        local json = HttpService:JSONEncode(out)
        if setclipboard then
            pcall(setclipboard, json)
            notify(("Copied %d pets from %d bases - paste into Zotac Auto List"):format(np, nb))
        else
            notify("This executor has no setclipboard")
        end
    end)
    close.MouseButton1Click:Connect(function() main.Visible = false; notify("Scanner hidden - press RightShift to show it") end)
    UIS.InputBegan:Connect(function(input, processed)
        if not processed and input.KeyCode == Enum.KeyCode.RightShift and gui.Parent then main.Visible = not main.Visible end
    end)

    local dragging, dragStart, startPos
    main.InputBegan:Connect(function(input)
        if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
            dragging, dragStart, startPos = true, input.Position, main.Position
            input.Changed:Connect(function() if input.UserInputState == Enum.UserInputState.End then dragging = false end end)
        end
    end)
    UIS.InputChanged:Connect(function(input)
        if dragging and (input.UserInputType == Enum.UserInputType.MouseMovement or input.UserInputType == Enum.UserInputType.Touch) then
            local d = input.Position - dragStart
            main.Position = UDim2.new(startPos.X.Scale, startPos.X.Offset + d.X, startPos.Y.Scale, startPos.Y.Offset + d.Y)
        end
    end)

    refresh()
end

if not game:IsLoaded() then game.Loaded:Wait() end
task.wait(1)
if SYNC then task.spawn(heartbeat) end
if SHOW_GUI then local okG, errG = pcall(buildGui); if not okG then notify("GUI failed: " .. tostring(errG)) end end

local function petCount(plot)
    local n = 0
    for _, c in ipairs(plot:GetChildren()) do if isPet(c) then n += 1 end end
    return n
end
-- the base and its pets stream in a few seconds after joining: wait until the pet models match
-- the game's own count for the base (or, without it, stop changing for 4 s) - at most 40 s
local function waitForPets()
    local t0, last, stableSince = os.clock(), -1, os.clock()
    while os.clock() - t0 < 40 do
        local plot = findMyPlot()
        if plot then
            local n = petCount(plot)
            if n ~= last then last, stableSince = n, os.clock() end
            local list = plotAnimalList(plot.Name)
            local expected = nil
            if list then expected = 0; for _, a in pairs(list) do if type(a) == "table" and type(a.Index) == "string" then expected += 1 end end end
            if expected and n >= expected and (expected > 0 or os.clock() - t0 > 8) then return true end
            if not expected and n > 0 and os.clock() - stableSince > 4 then return true end
            if not expected and n == 0 and os.clock() - stableSince > 15 then return true end
        end
        task.wait(0.5)
    end
    return false
end
waitForPets()
runOnce(true)
pcall(runServer)
local function rescanWanted()
    if not httpRequest or ZOTAC_TOKEN == "PASTE_AGENT_TOKEN" then return false end
    local ok, res = pcall(httpRequest, {
        Url = "http://127.0.0.1:" .. ZOTAC_PORT .. "/scanner/wanted?account=" .. HttpService:UrlEncode(LP.Name),
        Method = "GET", Headers = {["X-Zotac-Token"] = ZOTAC_TOKEN},
    })
    if not ok or not res or res.StatusCode ~= 200 then return false end
    local okD, d = pcall(HttpService.JSONDecode, HttpService, res.Body)
    return okD and type(d) == "table" and d.rescan == true
end
if SYNC then task.spawn(function()
    local t = 0
    while running do
        task.wait(5)
        if not running then break end
        t += 5
        if rescanWanted() then lastSig = nil; pcall(runOnce, false); pcall(runServer, true) end
        if t % 30 == 0 then heartbeat() end
    end
end) end
