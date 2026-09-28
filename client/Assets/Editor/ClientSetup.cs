using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.Callbacks;
using UnityEditor.SceneManagement;
using UnityEngine;

#if UNITY_IOS
using UnityEditor.iOS.Xcode;
#endif
namespace TowerDef.Editor
{
    public static class ClientSetup
    {
        public const string ScenePath = "Assets/Scenes/Mobile.unity";
        [MenuItem("Towerdef/첫 실행 준비")]
        public static void Prepare()
        {
            if (!Application.isBatchMode && !EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
                return;
            Directory.CreateDirectory("Assets/Scenes");
            if (!File.Exists(ScenePath))
            {
                var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                EditorSceneManager.SaveScene(scene, ScenePath);
            }
            else
                EditorSceneManager.OpenScene(ScenePath);
            EditorBuildSettings.scenes = new[]
            {
                new EditorBuildSettingsScene(ScenePath, true)
            };
            PlayerSettings.companyName = "TowerdefPrototype";
            PlayerSettings.productName = "폐품로봇 원정대";
            PlayerSettings.defaultScreenWidth = 390;
            PlayerSettings.defaultScreenHeight = 844;
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.Portrait;
            PlayerSettings.allowedAutorotateToLandscapeLeft = false;
            PlayerSettings.allowedAutorotateToLandscapeRight = false;
            PlayerSettings.allowedAutorotateToPortraitUpsideDown = false;
            PlayerSettings.runInBackground = false;
            PlayerSettings.insecureHttpOption = InsecureHttpOption.DevelopmentOnly;
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.iOS, "com.towerdef.mobileprototype");
            EditorUserBuildSettings.development = true;
            AssetDatabase.SaveAssets();
            Debug.Log("세로 UGUI 개발 장면 준비 완료. 실기기에는 같은 Wi-Fi의 서버 주소를 입력하세요.");
        }

        [MenuItem("Towerdef/iOS 개발 프로젝트 내보내기")]
        public static void BuildIosDevelopment()
        {
            Prepare();
            if (!BuildPipeline.IsBuildTargetSupported(BuildTargetGroup.iOS, BuildTarget.iOS))
                throw new BuildFailedException("iOS Build Support가 설치된 Unity 편집기가 필요합니다.");
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions { scenes = new[] { ScenePath }, locationPathName = "Builds/iOS", target = BuildTarget.iOS, options = BuildOptions.Development });
            if (report.summary.result != BuildResult.Succeeded)
                throw new BuildFailedException("iOS 개발 프로젝트 생성 실패");
        }

        [PostProcessBuild(100)]
        public static void ConfigureIos(BuildTarget target, string output)
        {
#if UNITY_IOS
            if(target!=BuildTarget.iOS)return;
            var projectPath=PBXProject.GetPBXProjectPath(output);
            var project=new PBXProject();project.ReadFromFile(projectPath);
            project.AddFrameworkToProject(project.GetUnityFrameworkTargetGuid(),"Security.framework",false);
            project.WriteToFile(projectPath);
            var path=Path.Combine(output,"Info.plist");var plist=new PlistDocument();plist.ReadFromFile(path);
            plist.root.SetString("NSLocalNetworkUsageDescription","같은 Wi-Fi의 개발 서버에 연결해 협동 원정을 검증합니다.");
            // Cleartext LAN is deliberately restricted to development builds.
            if(EditorUserBuildSettings.development)
            {
                var ats=plist.root.CreateDict("NSAppTransportSecurity");
                ats.SetBoolean("NSAllowsLocalNetworking",true);
                ats.SetBoolean("NSAllowsArbitraryLoads",true);
            }
            plist.WriteToFile(path);
#endif
        }
    }

    public sealed class DevelopmentBuildOnly : IPreprocessBuildWithReport
    {
        public int callbackOrder => 0;

        public void OnPreprocessBuild(BuildReport report)
        {
            if ((report.summary.options & BuildOptions.Development) == 0)
                throw new BuildFailedException("현재 클라이언트는 비공개 실기기 검증용입니다. 공개 Release 빌드는 차단됩니다.");
        }
    }
}
