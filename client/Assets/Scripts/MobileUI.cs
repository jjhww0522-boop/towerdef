using System;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace TowerDef
{
    public static class MobileUI
    {
        public static readonly Color Background = new Color(.045f, .09f, .12f), Panel = new Color(.09f, .17f, .21f), Gold = new Color(1, .76f, .36f);
        static Font font;
        public static Font Font => font ? font : (font = Resources.Load<Font>("MobileArt/Fonts/DoHyeon-Regular") ?? Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf"));

        public static RectTransform Box(Transform parent, string name, Color? color = null)
        {
            var obj = new GameObject(name, typeof(RectTransform));
            var rect = obj.GetComponent<RectTransform>();
            rect.SetParent(parent, false);
            if (color.HasValue)
            {
                var image = obj.AddComponent<Image>();
                image.color = color.Value;
            }

            return rect;
        }

        public static void Stretch(RectTransform rect, float left = 0, float bottom = 0, float right = 0, float top = 0)
        {
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.offsetMin = new Vector2(left, bottom);
            rect.offsetMax = new Vector2(-right, -top);
        }

        public static void Fixed(RectTransform rect, float left, float bottom, float right, float height)
        {
            rect.anchorMin = new Vector2(0, 0);
            rect.anchorMax = new Vector2(1, 0);
            rect.offsetMin = new Vector2(left, bottom);
            rect.offsetMax = new Vector2(-right, bottom + height);
        }

        public static Text Label(Transform parent, string value, int size = 18, float height = 44)
        {
            var rect = Box(parent, "Text");
            var text = rect.gameObject.AddComponent<Text>();
            text.font = Font;
            text.text = value;
            text.fontSize = size;
            text.color = Color.white;
            text.alignment = TextAnchor.MiddleLeft;
            text.raycastTarget = false;
            var layout = rect.gameObject.AddComponent<LayoutElement>();
            layout.minHeight = height;
            layout.preferredHeight = height;
            layout.flexibleWidth = 1;
            return text;
        }

        public static Button Button(Transform parent, string value, Action action, float height = 48, Color? color = null)
        {
            var rect = Box(parent, "Button", color ?? Panel);
            var button = rect.gameObject.AddComponent<Button>();
            var layout = rect.gameObject.AddComponent<LayoutElement>();
            layout.minHeight = height;
            layout.preferredHeight = height;
            layout.flexibleWidth = 1;
            var label = Label(rect, value, 18, height);
            Stretch(label.rectTransform, 7, 2, 7, 2);
            label.alignment = TextAnchor.MiddleCenter;
            if (color.HasValue && color.Value.grayscale > .55f)
                label.color = Background;
            button.onClick.AddListener(() => action());
            return button;
        }

        public static void SetText(Button button, string value)
        {
            button.GetComponentInChildren<Text>().text = value;
        }

        public static RectTransform Row(Transform parent, float height = 50)
        {
            var rect = Box(parent, "Row");
            var group = rect.gameObject.AddComponent<HorizontalLayoutGroup>();
            group.spacing = 6;
            group.childForceExpandHeight = true;
            group.childForceExpandWidth = true;
            rect.gameObject.AddComponent<LayoutElement>().preferredHeight = height;
            return rect;
        }

        public static void Vertical(RectTransform rect, int padding = 10, float spacing = 8)
        {
            var group = rect.gameObject.AddComponent<VerticalLayoutGroup>();
            group.padding = new RectOffset(padding, padding, padding, padding);
            group.spacing = spacing;
            group.childControlHeight = true;
            group.childForceExpandHeight = false;
            group.childForceExpandWidth = true;
        }

        public static RectTransform Scroll(Transform parent)
        {
            var rect = Box(parent, "Scroll");
            Stretch(rect);
            rect.gameObject.AddComponent<Image>().color = new Color(0, 0, 0, .001f);
            rect.gameObject.AddComponent<RectMask2D>();
            var scroll = rect.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false;
            scroll.viewport = rect;
            var content = Box(rect, "Content");
            content.anchorMin = new Vector2(0, 1);
            content.anchorMax = Vector2.one;
            content.pivot = new Vector2(.5f, 1);
            content.offsetMin = Vector2.zero;
            content.offsetMax = Vector2.zero;
            Vertical(content);
            content.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.content = content;
            return content;
        }

        public static InputField Input(Transform parent, string value, string hint)
        {
            var rect = Box(parent, "Input", new Color(.15f, .23f, .28f));
            rect.gameObject.AddComponent<LayoutElement>().preferredHeight = 50;
            var field = rect.gameObject.AddComponent<InputField>();
            var text = Label(rect, value, 18);
            Stretch(text.rectTransform, 10, 2, 10, 2);
            text.supportRichText = false;
            var placeholder = Label(rect, hint, 18);
            Stretch(placeholder.rectTransform, 10, 2, 10, 2);
            placeholder.color = Color.gray;
            field.textComponent = text;
            field.placeholder = placeholder;
            field.text = value;
            field.lineType = InputField.LineType.SingleLine;
            return field;
        }

        public static void Clear(Transform parent)
        {
            for (int i = parent.childCount - 1; i >= 0; i--)
            {
                var child = parent.GetChild(i).gameObject;
                child.SetActive(false);
                UnityEngine.Object.Destroy(child);
            }
        }
    }

    public sealed class SafeAreaPanel : MonoBehaviour
    {
        Rect previous;
        Vector2 screen;
        void Update()
        {
            var area = Screen.safeArea;
            if (area == previous && screen == new Vector2(Screen.width, Screen.height))
                return;
            previous = area;
            screen = new Vector2(Screen.width, Screen.height);
            var rect = (RectTransform)transform;
            rect.anchorMin = new Vector2(area.x / Screen.width, area.y / Screen.height);
            rect.anchorMax = new Vector2(area.xMax / Screen.width, area.yMax / Screen.height);
            rect.offsetMin = rect.offsetMax = Vector2.zero;
        }
    }
}
