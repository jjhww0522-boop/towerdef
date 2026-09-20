using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace TowerDef.Editor
{
    public static class ClientSetup
    {
        [MenuItem("Towerdef/첫 실행 준비")]
        public static void Prepare()
        {
            if (!Application.isBatchMode && !EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            const string scenePath = "Assets/Scenes/Practice.unity";
            Directory.CreateDirectory("Assets/Scenes");
            if (!File.Exists(scenePath))
            {
                var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                EditorSceneManager.SaveScene(scene, scenePath);
            }
            else EditorSceneManager.OpenScene(scenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(scenePath, true) };
            PlayerSettings.companyName = "TowerdefPrototype";
            PlayerSettings.productName = "Towerdef Practice";
            PlayerSettings.defaultScreenWidth = 1280;
            PlayerSettings.defaultScreenHeight = 720;
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.LandscapeLeft;
            PlayerSettings.runInBackground = true;
            PlayerSettings.insecureHttpOption = InsecureHttpOption.DevelopmentOnly;
            EditorUserBuildSettings.development = true;
            AssetDatabase.SaveAssets();
            Debug.Log("연습 장면 준비 완료. 로컬 서버를 실행하고 Play를 누르세요. HTTP 연결은 개발 빌드 전용입니다.");
        }
    }
}
