using System;
using System.Collections;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using UnityEngine;
using UnityEngine.Networking;

namespace TowerDef
{
    // Profile credentials and current expedition credentials are separate. All spending is server-authoritative.
    public sealed class LocalSession : MonoBehaviour
    {
        public string ServerUrl = "http://127.0.0.1:7351";
        public Content Content { get; private set; }
        public Profile Profile { get; private set; }
        public GameState State { get; private set; }
        public string Notice { get; private set; } = "개발 서버 주소를 입력하세요.";
        public bool Busy { get; private set; }
        public bool Connected { get; private set; }
        public bool Ready => Content != null && Profile != null && !storageFailed;
        public bool HasPendingAction => ledger.Pending != null;
        public bool HasSavedSession => !string.IsNullOrEmpty(saved.battleToken) || saved.entry != null;
        public string PlayerId => saved.playerId;
        public string RoomId => saved.roomId;

        public event Action<GameState> Snapshot;
        public event Action Changed;
        readonly ActionLedger ledger = new ActionLedger();
        SavedSession saved = new SavedSession();
        string storageKey, lastError;
        float nextPoll;
        bool paused, storageFailed, pollBusy;
        [Serializable]
        sealed class SavedSession
        {
            public string profileToken, playerId, roomId, battleToken;
            public ActionRequest pending;
            public SessionRequest entry;
        }

        void Awake()
        {
            ServerUrl = PlayerPrefs.GetString("td.mobile.server", ServerUrl);
            Application.runInBackground = false;
        }

        void Update()
        {
            if (!paused && !Busy && !pollBusy && Connected && State != null && Time.unscaledTime >= nextPoll)
                StartCoroutine(Poll());
        }

        public Player Me() => State == null ? null : Array.Find(State.players, p => p.id == saved.playerId);
        void Notify()
        {
            Changed?.Invoke();
        }

        bool Persist()
        {
            saved.pending = ledger.Pending;
            try
            {
                SecretStore.Set(storageKey, JsonConvert.SerializeObject(saved));
                return true;
            }
            catch (Exception)
            {
                storageFailed = true;
                Connected = false;
                Notice = "보안 저장 오류. 기기 잠금을 해제하고 다시 연결하세요.";
                Notify();
                return false;
            }
        }

        public void Connect()
        {
            if (Busy)
                return;
            ServerUrl = ServerUrl.Trim().TrimEnd('/');
            if (!Uri.TryCreate(ServerUrl, UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https"))
            {
                Notice = "http 또는 https 서버 주소를 확인하세요.";
                Notify();
                return;
            }

            StartCoroutine(Bootstrap());
        }

        IEnumerator Bootstrap()
        {
            Busy = true;
            Connected = false;
            State = null;
            Content = null;
            Profile = null;
            storageFailed = false;
            using (var sha = SHA256.Create())
                storageKey = "td.mobile." + BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(ServerUrl))).Replace("-", "");
            bool loaded = true;
            try
            {
                var raw = SecretStore.Get(storageKey);
                saved = string.IsNullOrEmpty(raw) ? new SavedSession() : JsonConvert.DeserializeObject<SavedSession>(raw);
                if (saved == null)
                    throw new InvalidOperationException();
                ledger.Restore(saved.pending);
            }
            catch (Exception)
            {
                loaded = false;
                storageFailed = true;
                Notice = "보안 저장을 읽지 못했습니다. 계정을 새로 만들지 않았습니다.";
            }

            if (!loaded)
            {
                Busy = false;
                Notify();
                yield break;
            }

            yield return Request<Content>("/content", null, null, c => Content = c);
            if (Content == null)
            {
                Busy = false;
                Notify();
                yield break;
            }

            if (string.IsNullOrEmpty(saved.profileToken))
                yield return Request<ProfileResponse>("/profile", new object (), null, r =>
                {
                    saved.profileToken = r.profileToken;
                    Profile = r.profile;
                    if (string.IsNullOrEmpty(saved.playerId))
                        saved.playerId = "mobile-" + Guid.NewGuid().ToString("N").Substring(0, 10);
                    Persist();
                });
            else
                yield return RefreshProfile();
            if (Ready)
            {
                PlayerPrefs.SetString("td.mobile.server", ServerUrl);
                PlayerPrefs.Save();
                Notice = HasSavedSession ? "저장된 원정이 있어요. 이어하기를 선택하세요." : "연결되었습니다. 기동 훈련은 무료입니다.";
            }

            Busy = false;
            Notify();
        }

        IEnumerator RefreshProfile()
        {
            yield return Request<ProfileResponse>("/profile", null, saved.profileToken, r => Profile = r.profile);
        }

        public void StartExpedition(int battlefieldId, bool tutorial, string room = null)
        {
            if (Busy || !Ready || HasSavedSession || ledger.Pending != null)
                return;
            StartCoroutine(Join(battlefieldId, tutorial, room ?? ("mobile-" + Guid.NewGuid().ToString("N").Substring(0, 12))));
        }

        IEnumerator Join(int battlefieldId, bool tutorial, string room)
        {
            Busy = true;
            Notice = "원정 참가를 확인합니다…";
            Notify();
            // Save the entry identity before transmission. A lost response can retry this same room without creating another expedition.
            saved.roomId = room;
            var request = saved.entry ?? new SessionRequest
            {
                roomId = room,
                playerId = saved.playerId,
                profileToken = saved.profileToken,
                contentVersion = Content.version,
                expectedServerInstanceId = Content.serverInstanceId,
                battlefieldId = battlefieldId,
                tutorial = tutorial
            };
            saved.entry = request;
            if (!Persist())
            {
                Busy = false;
                yield break;
            }

            bool restarted = false;
            yield return Request<SessionResponse>("/session", request, null, r =>
            {
                saved.battleToken = r.token;
                saved.entry = null;
                Profile = r.profile ?? Profile;
                if (!string.IsNullOrEmpty(r.profileToken))
                    saved.profileToken = r.profileToken;
                if (Persist())
                    Accept(r.state);
            }, code =>
            {
                if (code >= 400 && code < 500)
                {
                    restarted = lastError == "server_restarted";
                    saved.entry = null;
                    if (restarted)
                    {
                        State = null;
                        saved.battleToken = null;
                        saved.roomId = null;
                        Connected = false;
                    }

                    Persist();
                }
            });
            if (restarted)
            {
                yield return RefreshProfile();
                yield return Request<Content>("/content", null, null, c => Content = c);
                Notice = "서버가 다시 시작되어 이전 입장을 중단했습니다. 새 출발을 직접 선택하세요.";
            }

            Busy = false;
            Notify();
        }

        public void Resume()
        {
            if (Busy || pollBusy || !Ready || !HasSavedSession)
                return;
            if (saved.entry != null)
            {
                StartCoroutine(Join(saved.entry.battlefieldId, saved.entry.tutorial, saved.entry.roomId));
                return;
            }

            Connected = true;
            StartCoroutine(Poll());
        }

        IEnumerator Poll()
        {
            pollBusy = true;
            var requestedToken = saved.battleToken;
            yield return Request<GameState>("/state", null, requestedToken, s =>
            {
                if (saved.battleToken == requestedToken)
                    Accept(s);
            }, code =>
            {
                if (saved.battleToken != requestedToken)
                    return;
                Connected = false;
                if (code == 401 || code == 403)
                {
                    State = null;
                    saved.battleToken = null;
                    saved.roomId = null;
                    ledger.Clear();
                    Persist();
                }
            });
            if (!Connected)
            {
                yield return RefreshProfile();
                Notice = Profile?.lastInterruption != null ? "서버 중단으로 원정이 종료되었습니다. 엔진 반환 " + Profile.lastInterruption.enginesRefunded + "개. 새 출발은 직접 선택하세요." : "원정을 확인하지 못했습니다. 이어하기로 다시 연결하세요.";
            }

            nextPoll = Time.unscaledTime + .2f;
            pollBusy = false;
            Notify();
        }

        public void Send(string type, string recipeId = null, string tag = null, int[] unitIds = null, string tactic = null, string offerId = null, string modId = null)
        {
            if (Busy || !Connected || storageFailed || ledger.Pending != null || Me() == null)
                return;
            ledger.Begin(new ActionRequest { seq = Me().lastSeq + 1, type = type, recipeId = recipeId, tag = tag, unitIds = unitIds, tactic = tactic, offerId = offerId, modId = modId });
            if (Persist())
                StartCoroutine(Submit());
        }

        public void RetryPending()
        {
            if (!Busy && Ready && HasSavedSession && ledger.Pending != null)
                StartCoroutine(Submit());
        }

        IEnumerator Submit()
        {
            Busy = true;
            var action = ledger.Pending;
            yield return Request<ActionResponse>("/action", action, saved.battleToken, r =>
            {
                if (!Accept(r.state))
                    return;
                Profile = r.profile ?? Profile;
                if (Me().lastSeq >= action.seq)
                {
                    ledger.Clear();
                    Persist();
                }

                Notice = r.ok ? "반영 완료" : "요청을 적용하지 못했습니다: " + ErrorCopy(r.error);
            });
            Busy = false;
            nextPoll = Time.unscaledTime + .2f;
            Notify();
        }

        public void ReturnHome()
        {
            if (Busy || ledger.Pending != null)
                return;
            StartCoroutine(Leave());
        }

        IEnumerator Leave()
        {
            if (Me()?.status == "active")
            {
                Send("leave");
                while (Busy)
                    yield return null;
                if (ledger.Pending != null || Me()?.status == "active")
                    yield break;
            }

            Busy = true;
            saved.battleToken = null;
            saved.roomId = null;
            saved.entry = null;
            Connected = false;
            State = null;
            ledger.Clear();
            Persist();
            yield return RefreshProfile();
            Busy = false;
            Notify();
        }

        public void Research(string recipeId)
        {
            if (!Busy && Ready)
                StartCoroutine(ResearchRoutine(recipeId));
        }

        IEnumerator ResearchRoutine(string recipeId)
        {
            Busy = true;
            yield return Request<ProfileResponse>("/research", new { recipeId }, saved.profileToken, r => Profile = r.profile);
            Busy = false;
            Notify();
        }

        bool Accept(GameState state)
        {
            if (state == null || state.protocolVersion != "1" || state.contentVersion != Content.version)
            {
                Connected = false;
                Notice = "콘텐츠 버전이 다릅니다. 앱과 서버를 같은 버전으로 맞추세요.";
                return false;
            }

            var incomingPlayer = Array.Find(state.players, p => p.id == saved.playerId);
            if (incomingPlayer == null)
            {
                Connected = false;
                Notice = "내 참가 정보를 찾지 못했습니다.";
                return false;
            }

            if (State != null && !MobileModel.IsMonotonic(State.tick, Me().lastSeq, state.tick, incomingPlayer.lastSeq))
                return false;
            State = state;
            Profile = state.profile ?? Profile;
            Connected = true;
            if (ledger.Acknowledge(Me().lastSeq))
                Persist();
            Notice = state.combatPaused ? "훈련 설명 중 · 전투 잠시 멈춤" : "서버 연결됨";
            Snapshot?.Invoke(state);
            return true;
        }

        IEnumerator Request<T>(string path, object body, string token, Action<T> success, Action<long> failure = null)
            where T : class
        {
            using (var request = new UnityWebRequest(ServerUrl + path, body == null ? "GET" : "POST"))
            {
                request.downloadHandler = new DownloadHandlerBuffer();
                request.timeout = 8;
                if (body != null)
                {
                    request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(body)));
                    request.SetRequestHeader("Content-Type", "application/json");
                }

                if (!string.IsNullOrEmpty(token))
                    request.SetRequestHeader("Authorization", "Bearer " + token);
                yield return request.SendWebRequest();
                if (request.result != UnityWebRequest.Result.Success)
                {
                    lastError = null;
                    try
                    {
                        lastError = JsonConvert.DeserializeObject<ProfileResponse>(request.downloadHandler.text)?.error;
                    }
                    catch (JsonException)
                    {
                    }

                    Notice = request.responseCode == 0 ? "연결을 확인하세요. 요청 결과가 불확실하면 같은 요청을 재시도하세요." : "서버 요청 거절 (" + request.responseCode + ")";
                    failure?.Invoke(request.responseCode);
                    yield break;
                }

                T value = null;
                try
                {
                    value = JsonConvert.DeserializeObject<T>(request.downloadHandler.text);
                }
                catch (JsonException)
                {
                    Notice = "서버 응답 형식을 확인하지 못했습니다.";
                }

                if (value != null)
                    success(value);
            }
        }

        void OnApplicationPause(bool value)
        {
            paused = value;
            if (value)
            {
                if (storageKey != null)
                    Persist();
                Connected = false;
            }
            else if (Ready && HasSavedSession && !Busy)
                Resume();
        }

        void OnApplicationFocus(bool value)
        {
            if (value && !paused && Ready && HasSavedSession && !Busy && !Connected)
                Resume();
        }

        static string ErrorCopy(string code)
        {
            switch (code)
            {
                case "INSUFFICIENT_GOLD":
                    return "고철이 부족해요";
                case "RECIPE_LOCKED":
                    return "아직 잠긴 조합이에요";
                case "INVALID_INGREDIENTS":
                    return "재료 상태가 바뀌었어요";
                case "NOT_ACTIVE":
                    return "원정이 종료됐어요";
                case "NO_ACTIVE_STORY":
                    return "진행 중인 스토리가 없어요";
                case "STALE_MOD_OFFER":
                    return "개조 기회가 바뀌었어요. 현재 선택지를 확인하세요";
                case "MOD_NOT_AVAILABLE":
                    return "현장개조 기회가 아직 열리지 않았어요";
                case "MOD_ALREADY_CHOSEN":
                    return "이번 개조 기회는 이미 사용했어요";
                case "UNKNOWN_FIELD_MOD":
                    return "개조 정보를 새로 확인해 주세요";
                default:
                    return "현재 상태에서는 실행할 수 없어요. 화면을 다시 확인하세요";
            }
        }
    }
}
