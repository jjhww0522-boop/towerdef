using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace TowerDef
{
    public sealed class LocalSession : MonoBehaviour
    {
        public string ServerUrl = "http://127.0.0.1:7351";
        public string RoomId = "practice-1";
        public string PlayerId;
        public Content Content { get; private set; }
        public GameState State { get; private set; }
        public string Notice { get; private set; } = "서버를 실행한 뒤 연습방에 연결하세요.";
        public bool Busy { get; private set; }
        public bool Connected { get; private set; }
        public bool HasPendingAction => pending != null;
        public event System.Action<GameState> Snapshot;

        string token, sessionKey;
        ActionRequest pending;
        float nextPoll;
        bool sessionEstablished;

        void Awake()
        {
            PlayerId = PlayerPrefs.GetString("towerdef.playerId", "");
            if (string.IsNullOrEmpty(PlayerId))
            {
                PlayerId = "player-" + Guid.NewGuid().ToString("N").Substring(0, 6);
                PlayerPrefs.SetString("towerdef.playerId", PlayerId);
            }
            Application.runInBackground = true;
        }

        void Update()
        {
            if (sessionEstablished && !Busy && Time.unscaledTime >= nextPoll)
                StartCoroutine(Poll());
        }

        public Player Me()
        {
            if (State?.players == null) return null;
            foreach (var player in State.players) if (player.id == PlayerId) return player;
            return null;
        }

        public void Connect()
        {
            if (Busy) return;
            ServerUrl = ServerUrl.Trim().TrimEnd('/');
            RoomId = RoomId.Trim();
            PlayerId = PlayerId.Trim();
            if (!Uri.TryCreate(ServerUrl, UriKind.Absolute, out var uri) ||
                (uri.Scheme != "http" && uri.Scheme != "https") || RoomId.Length == 0 || PlayerId.Length == 0)
            { Notice = "서버 주소, 방 이름, 참가자 ID를 확인하세요."; return; }
            var key = "towerdef.session." + ServerUrl + "/" + RoomId + "/" + PlayerId;
            if (sessionKey != key)
            {
                pending = null;
                State = null;
                sessionKey = key;
                token = PlayerPrefs.GetString(key, "");
            }
            sessionEstablished = false;
            StartCoroutine(Join());
        }

        public void LeaveRoom()
        {
            if (!Busy) StartCoroutine(LeaveAndReset());
        }

        IEnumerator LeaveAndReset()
        {
            sessionEstablished = false;
            if (Connected && Me() != null && Me().status == "active" && pending == null)
            {
                pending = new ActionRequest { seq = Me().lastSeq + 1, type = "leave" };
                yield return Submit();
            }
            Connected = false;
            State = null;
            pending = null;
            Notice = "방 설정입니다. 새 연습은 새 방 이름으로 시작하세요.";
        }

        IEnumerator Join()
        {
            Busy = true;
            Notice = "콘텐츠와 참가 정보를 확인하고 있습니다…";
            using (var request = MakeRequest("/content", "GET"))
            {
                yield return request.SendWebRequest();
                if (!Succeeded(request)) { Busy = false; yield break; }
                Content = Parse<Content>(request.downloadHandler.text);
            }
            if (Content?.units == null || Content.recipes == null || Content.rules?.upgradeCosts == null || Content.rules.upgradeCosts.Length < Content.rules.maxUpgradeLevel)
            { Notice = "서버 콘텐츠 형식이 올바르지 않습니다."; Busy = false; yield break; }
            var body = new SessionRequest { roomId = RoomId, playerId = PlayerId, contentVersion = Content.version };
            using (var request = MakeRequest("/session", "POST", JsonUtility.ToJson(body)))
            {
                yield return request.SendWebRequest();
                if (!Succeeded(request)) { Busy = false; yield break; }
                var response = Parse<SessionResponse>(request.downloadHandler.text);
                if (response?.state == null || string.IsNullOrEmpty(response.token))
                { Notice = "참가 응답을 읽지 못했습니다."; Busy = false; yield break; }
                if (token != response.token) { State = null; pending = null; }
                token = response.token;
                PlayerPrefs.SetString(sessionKey, token);
                PlayerPrefs.SetString("towerdef.playerId", PlayerId);
                PlayerPrefs.Save();
                sessionEstablished = true;
                Accept(response.state);
                if (Connected) Notice = "연습방 연결됨 · 영구 보상 없음";
            }
            Busy = false;
            nextPoll = Time.unscaledTime + .2f;
        }

        IEnumerator Poll()
        {
            Busy = true;
            using (var request = MakeRequest("/state", "GET"))
            {
                yield return request.SendWebRequest();
                if (Succeeded(request))
                {
                    var state = Parse<GameState>(request.downloadHandler.text);
                    if (state != null) Accept(state);
                }
            }
            nextPoll = Time.unscaledTime + (Connected ? .2f : 2f);
            Busy = false;
        }

        public void Send(string type, string recipeId = null, string tag = null, int[] unitIds = null)
        {
            if (Busy || !Connected || pending != null || Me() == null) return;
            pending = new ActionRequest { seq = Me().lastSeq + 1, type = type, recipeId = recipeId, tag = tag, unitIds = unitIds };
            StartCoroutine(Submit());
        }

        public void RetryPending()
        {
            if (!Busy && sessionEstablished && pending != null) StartCoroutine(Submit());
        }

        IEnumerator Submit()
        {
            Busy = true;
            using (var request = MakeRequest("/action", "POST", JsonUtility.ToJson(pending)))
            {
                yield return request.SendWebRequest();
                // An ambiguous transport failure keeps the exact sequence and payload for retry.
                if (request.result == UnityWebRequest.Result.Success)
                {
                    var response = Parse<ActionResponse>(request.downloadHandler.text);
                    if (response?.state != null)
                    {
                        Accept(response.state);
                        pending = null;
                        Notice = response.ok ? "행동이 반영되었습니다." : "요청 거절: " + response.error;
                    }
                    else Notice = "행동 응답을 읽지 못했습니다. 같은 요청을 재시도하세요.";
                }
                else Succeeded(request);
            }
            Busy = false;
            nextPoll = Time.unscaledTime + .2f;
        }

        UnityWebRequest MakeRequest(string path, string method, string body = null)
        {
            var request = new UnityWebRequest(ServerUrl + path, method) { downloadHandler = new DownloadHandlerBuffer(), timeout = 5 };
            if (body != null)
            {
                request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body));
                request.SetRequestHeader("Content-Type", "application/json");
            }
            if (!string.IsNullOrEmpty(token)) request.SetRequestHeader("Authorization", "Bearer " + token);
            return request;
        }

        bool Succeeded(UnityWebRequest request)
        {
            if (request.result == UnityWebRequest.Result.Success) return true;
            Connected = false;
            Notice = request.responseCode == 0
                ? "서버 연결이 끊겼습니다. 자동 재연결 중…"
                : "서버 오류 " + request.responseCode + ": " + request.downloadHandler.text;
            if (request.responseCode == 401 || request.responseCode == 403)
            {
                sessionEstablished = false;
                Notice += " · 서버 재시작 시 새 참가자 ID로 접속하세요.";
            }
            return false;
        }

        T Parse<T>(string json) where T : class
        {
            try { return JsonUtility.FromJson<T>(json); }
            catch (ArgumentException) { Notice = "서버 응답을 읽지 못했습니다."; return null; }
        }

        void Accept(GameState state)
        {
            if (state.protocolVersion != "1" || state.contentVersion != Content.version || state.players == null)
            {
                Notice = "클라이언트와 서버 버전이 다릅니다. 최신 파일로 다시 실행하세요.";
                Connected = false;
                sessionEstablished = false;
                return;
            }
            if (State != null && state.tick < State.tick) return;
            bool recovering = !Connected;
            State = state;
            Connected = true;
            if (pending != null && Me() != null && Me().lastSeq >= pending.seq) pending = null;
            if (recovering) Notice = "연결 복구됨 · 현재 서버 상태를 표시합니다.";
            Snapshot?.Invoke(state);
        }
    }
}
