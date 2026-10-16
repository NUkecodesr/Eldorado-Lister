if not game:IsLoaded() then game.Loaded:Wait() end
do local t0 = os.clock(); while game.PlaceId == 0 and os.clock() - t0 < 60 do task.wait(0.25) end end
if game.PlaceId ~= 109983668079237 then return end

local ZOTAC_PORT  = 47321
local ZOTAC_TOKEN = "PASTE_AGENT_TOKEN"
local AUTO_SECONDS = 30
local SCAN_SERVER = true

local Players     = game:GetService("Players")
local HttpService = game:GetService("HttpService")
local StarterGui  = game:GetService("StarterGui")
while not Players.LocalPlayer do task.wait(0.1) end
local LP = Players.LocalPlayer
local PG = LP:WaitForChild("PlayerGui")

if _G.ZotacScannerStop then pcall(_G.ZotacScannerStop) end
local running = true
_G.ZotacScannerStop = function() running = false end

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
    local dataByName = {}
    local animals = plotAnimalList(plot.Name)
    if animals then
        for _, a in pairs(animals) do
            if type(a) == "table" and type(a.Index) == "string" then
                dataByName[a.Index] = dataByName[a.Index] or {}
                table.insert(dataByName[a.Index], a)
            end
        end
    end

    local pets = {}
    for _, c in ipairs(plot:GetChildren()) do
        if isPet(c) then
            local o = nearestOverhead(overheads, c.Name, c:GetPivot().Position, used)
            local genL = o and o.gui:FindFirstChild("Generation")
            local rarL = o and o.gui:FindFirstChild("Rarity")
            local q = dataByName[c.Name]
            local a = q and table.remove(q, 1)
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
    return pets, animals
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
    local pets, animals = readPlot(plot, overheads, {}, true)
    return {username = LP.Name, userId = LP.UserId, displayName = LP.DisplayName, scannedAt = os.time(), pets = pets, traitsKnown = animals ~= nil or #overheads > 0}
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
    local okA, art = pcall(collectArt, data.pets)
    if okA then data.art = art end
    if modelsOut then
        data.art = data.art or {}
        data.art.models = modelsOut
    end
    local json = HttpService:JSONEncode(data)
    if first and setclipboard then pcall(setclipboard, json) end
    local ok, why = send(data)
    if ok then
        for k in pairs((data.art and data.art.models) or {}) do modelsSent[k] = true end
        if data.art and data.art.allIcons then _G.ZotacAllIconsSent = true end
        notify(#data.pets .. " pets sent to Zotac" .. (first and " (also copied)" or ""))
    elseif first then
        notify(#data.pets .. " pets copied - paste into Zotac Auto List (" .. why .. ")")
    end
end

local function scanServer()
    local plots = workspace:FindFirstChild("Plots")
    if not plots then return nil end
    local overheads, used = readOverheads(), {}
    local mine = ownPlotName and plots:FindFirstChild(ownPlotName)
    local bases = {}
    for _, plot in ipairs(plots:GetChildren()) do
        local okR, pets = pcall(readPlot, plot, overheads, used, false)
        if not okR or type(pets) ~= "table" then pets = {} end
        local name, display, uid = ownerInfo(plot)
        if name or #pets > 0 then
            local total = 0
            for _, p in ipairs(pets) do total += (p.gen or 0) end
            table.insert(bases, {plot = plot.Name, owner = name, displayName = display, userId = uid, mine = plot == mine or uid == LP.UserId, pets = pets, totalGen = total})
        end
    end
    table.sort(bases, function(a, b) return a.totalGen > b.totalGen end)
    return {jobId = game.JobId, placeId = game.PlaceId, by = LP.Name, players = #Players:GetPlayers(), scannedAt = os.time(), bases = bases}
end

local lastServerSig, lastServerAt = nil, 0
local function runServer()
    if not SCAN_SERVER then return end
    local data = scanServer()
    if not data then return end
    local parts = {}
    for _, b in ipairs(data.bases) do table.insert(parts, b.plot .. "=" .. tostring(b.owner) .. ":" .. signature(b)) end
    local sig = table.concat(parts, "#")
    if sig == lastServerSig and os.clock() - lastServerAt < 120 then return end
    local ok = post("/scanner/server", data)
    if ok then lastServerSig, lastServerAt = sig, os.clock() end
end

if not game:IsLoaded() then game.Loaded:Wait() end
task.wait(3)
heartbeat()

for _ = 1, 10 do
    if findMyPlot() then break end
    task.wait(3)
end
runOnce(true)
pcall(runServer)
task.spawn(function()
    local t = 0
    while running do
        task.wait(30)
        if not running then break end
        heartbeat()
        t += 30
        if AUTO_SECONDS > 0 and t >= AUTO_SECONDS then t = 0; pcall(runOnce, false); pcall(runServer) end
    end
end)
