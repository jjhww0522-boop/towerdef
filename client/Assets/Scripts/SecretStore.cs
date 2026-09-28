using System;
using System.Runtime.InteropServices;
using UnityEngine;

namespace TowerDef
{
    public static class SecretStore
    {
#if UNITY_IOS && !UNITY_EDITOR
        [DllImport("__Internal")] static extern int TDKeychainSet(string key,string value);
        [DllImport("__Internal")] static extern IntPtr TDKeychainGet(string key,out int status);
        [DllImport("__Internal")] static extern int TDKeychainDelete(string key);
        [DllImport("__Internal")] static extern void TDKeychainFree(IntPtr pointer);
#endif
        public static string Get(string key)
        {
#if UNITY_IOS && !UNITY_EDITOR
            var pointer=TDKeychainGet(key,out var status);
            if(status==-25300)return "";
            if(status!=0)throw new InvalidOperationException("보안 저장을 읽지 못했습니다. 잠금을 해제한 뒤 다시 시도하세요.");
            if(pointer==IntPtr.Zero)throw new InvalidOperationException("보안 저장 응답이 비어 있습니다.");
            try{return Marshal.PtrToStringAnsi(pointer);}finally{TDKeychainFree(pointer);}
#else
            return PlayerPrefs.GetString(key, "");
#endif
        }

        public static void Set(string key, string value)
        {
#if UNITY_IOS && !UNITY_EDITOR
            if(TDKeychainSet(key,value)!=0)throw new InvalidOperationException("보안 저장에 실패했습니다. 다시 시도하세요.");
#else
            PlayerPrefs.SetString(key, value);
            PlayerPrefs.Save();
#endif
        }

        public static void Delete(string key)
        {
#if UNITY_IOS && !UNITY_EDITOR
            var status=TDKeychainDelete(key);if(status!=0&&status!=-25300)throw new InvalidOperationException("보안 저장 삭제에 실패했습니다.");
#else
            PlayerPrefs.DeleteKey(key);
            PlayerPrefs.Save();
#endif
        }
    }
}
