#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0A00
#include <windows.h>

#include <algorithm>
#include <cstdint>
#include <cwctype>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace {

struct WindowInfo {
  HWND hwnd = nullptr;
  std::wstring title;
  std::wstring className;
  RECT bounds{};
  bool visible = false;
  bool minimized = false;
  bool foreground = false;
  UINT dpi = 96;
};

std::string utf8(const std::wstring& value) {
  if (value.empty()) return {};
  const int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()),
                                       nullptr, 0, nullptr, nullptr);
  if (size <= 0) return {};
  std::string out(static_cast<std::size_t>(size), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()),
                      out.data(), size, nullptr, nullptr);
  return out;
}

std::string escapeJson(const std::string& value) {
  std::ostringstream out;
  for (const unsigned char ch : value) {
    switch (ch) {
      case '"': out << "\\\""; break;
      case '\\': out << "\\\\"; break;
      case '\b': out << "\\b"; break;
      case '\f': out << "\\f"; break;
      case '\n': out << "\\n"; break;
      case '\r': out << "\\r"; break;
      case '\t': out << "\\t"; break;
      default:
        if (ch < 0x20) {
          const char* hex = "0123456789abcdef";
          out << "\\u00" << hex[(ch >> 4) & 0x0F] << hex[ch & 0x0F];
        } else {
          out << static_cast<char>(ch);
        }
    }
  }
  return out.str();
}

std::wstring windowText(HWND hwnd) {
  const int length = GetWindowTextLengthW(hwnd);
  if (length <= 0 || length > 1024) return {};
  std::vector<wchar_t> buffer(static_cast<std::size_t>(length) + 1, L'\0');
  const int copied = GetWindowTextW(hwnd, buffer.data(), static_cast<int>(buffer.size()));
  if (copied <= 0) return {};
  return std::wstring(buffer.data(), static_cast<std::size_t>(copied));
}

std::wstring className(HWND hwnd) {
  wchar_t buffer[256]{};
  const int copied = GetClassNameW(hwnd, buffer, 255);
  if (copied <= 0) return {};
  return std::wstring(buffer, static_cast<std::size_t>(copied));
}

bool readWindow(HWND hwnd, WindowInfo& info) {
  if (!IsWindow(hwnd)) return false;
  info.hwnd = hwnd;
  info.title = windowText(hwnd);
  info.className = className(hwnd);
  info.visible = IsWindowVisible(hwnd) == TRUE;
  info.minimized = IsIconic(hwnd) == TRUE;
  info.foreground = GetForegroundWindow() == hwnd;
  if (!GetWindowRect(hwnd, &info.bounds)) return false;
  info.dpi = GetDpiForWindow(hwnd);
  if (info.dpi == 0) info.dpi = 96;
  return true;
}

std::string hwndString(HWND hwnd) {
  return std::to_string(static_cast<unsigned long long>(reinterpret_cast<std::uintptr_t>(hwnd)));
}

void printWindowJson(const WindowInfo& info) {
  const long width = std::max<LONG>(1, info.bounds.right - info.bounds.left);
  const long height = std::max<LONG>(1, info.bounds.bottom - info.bounds.top);
  std::cout
      << "{\"id\":\"" << hwndString(info.hwnd) << "\""
      << ",\"title\":\"" << escapeJson(utf8(info.title)) << "\""
      << ",\"className\":\"" << escapeJson(utf8(info.className)) << "\""
      << ",\"visible\":" << (info.visible ? "true" : "false")
      << ",\"minimized\":" << (info.minimized ? "true" : "false")
      << ",\"foreground\":" << (info.foreground ? "true" : "false")
      << ",\"bounds\":{\"x\":" << info.bounds.left
      << ",\"y\":" << info.bounds.top
      << ",\"width\":" << width
      << ",\"height\":" << height
      << ",\"scaleFactor\":" << (static_cast<double>(info.dpi) / 96.0)
      << "}}";
}

BOOL CALLBACK enumWindowsProc(HWND hwnd, LPARAM param) {
  auto* windows = reinterpret_cast<std::vector<WindowInfo>*>(param);
  WindowInfo info;
  if (!readWindow(hwnd, info)) return TRUE;
  if (!info.visible || info.title.empty()) return TRUE;
  const long width = info.bounds.right - info.bounds.left;
  const long height = info.bounds.bottom - info.bounds.top;
  if (width < 200 || height < 120) return TRUE;
  windows->push_back(std::move(info));
  return TRUE;
}

HWND parseHwnd(const wchar_t* value) {
  if (!value || !*value) return nullptr;
  wchar_t* end = nullptr;
  const unsigned long long raw = std::wcstoull(value, &end, 10);
  if (!end || *end != L'\0' || raw == 0) return nullptr;
  return reinterpret_cast<HWND>(static_cast<std::uintptr_t>(raw));
}

bool targetReady(HWND hwnd, WindowInfo* out = nullptr) {
  WindowInfo info;
  if (!readWindow(hwnd, info)) return false;
  if (!info.visible || info.minimized || !info.foreground) return false;
  if (out) *out = info;
  return true;
}

bool moveCursorIntoTarget(const WindowInfo& info, POINT& previous) {
  if (!GetCursorPos(&previous)) return false;
  const int x = info.bounds.left + std::max<LONG>(1, info.bounds.right - info.bounds.left) / 2;
  const int y = info.bounds.top + std::max<LONG>(1, info.bounds.bottom - info.bounds.top) / 2;
  return SetCursorPos(x, y) == TRUE;
}

bool sendMouseWheel(HWND hwnd, int notches) {
  WindowInfo info;
  if (!targetReady(hwnd, &info)) return false;
  POINT previous{};
  if (!moveCursorIntoTarget(info, previous)) return false;
  if (!targetReady(hwnd)) {
    SetCursorPos(previous.x, previous.y);
    return false;
  }

  INPUT input{};
  input.type = INPUT_MOUSE;
  input.mi.dwFlags = MOUSEEVENTF_WHEEL;
  input.mi.mouseData = static_cast<DWORD>(WHEEL_DELTA * notches);
  const UINT sent = SendInput(1, &input, sizeof(INPUT));
  SetCursorPos(previous.x, previous.y);
  return sent == 1;
}

bool sendClick(HWND hwnd, int xPermille, int yPermille) {
  WindowInfo info;
  if (!targetReady(hwnd, &info)) return false;
  xPermille = std::clamp(xPermille, 0, 10000);
  yPermille = std::clamp(yPermille, 0, 10000);

  POINT previous{};
  if (!GetCursorPos(&previous)) return false;
  const long width = std::max<LONG>(1, info.bounds.right - info.bounds.left);
  const long height = std::max<LONG>(1, info.bounds.bottom - info.bounds.top);
  const int x = info.bounds.left + static_cast<int>((static_cast<long long>(width) * xPermille) / 10000);
  const int y = info.bounds.top + static_cast<int>((static_cast<long long>(height) * yPermille) / 10000);
  if (!SetCursorPos(x, y)) return false;
  Sleep(25);
  if (!targetReady(hwnd)) {
    SetCursorPos(previous.x, previous.y);
    return false;
  }

  INPUT inputs[2]{};
  inputs[0].type = INPUT_MOUSE;
  inputs[0].mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
  inputs[1].type = INPUT_MOUSE;
  inputs[1].mi.dwFlags = MOUSEEVENTF_LEFTUP;
  const UINT sent = SendInput(2, inputs, sizeof(INPUT));
  Sleep(25);
  SetCursorPos(previous.x, previous.y);
  return sent == 2;
}

bool sendHome(HWND hwnd) {
  if (!targetReady(hwnd)) return false;
  INPUT inputs[2]{};
  inputs[0].type = INPUT_KEYBOARD;
  inputs[0].ki.wVk = VK_HOME;
  inputs[1].type = INPUT_KEYBOARD;
  inputs[1].ki.wVk = VK_HOME;
  inputs[1].ki.dwFlags = KEYEVENTF_KEYUP;
  return SendInput(2, inputs, sizeof(INPUT)) == 2;
}

void printStatus(HWND hwnd) {
  WindowInfo info;
  if (!readWindow(hwnd, info)) {
    std::cout << "{\"exists\":false}";
    return;
  }
  std::cout << "{\"exists\":true,\"window\":";
  printWindowJson(info);
  std::cout << "}";
}

void printResult(bool ok, const char* reason = nullptr) {
  std::cout << "{\"ok\":" << (ok ? "true" : "false");
  if (reason) std::cout << ",\"reason\":\"" << reason << "\"";
  std::cout << "}";
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  SetConsoleOutputCP(CP_UTF8);
  std::ios::sync_with_stdio(false);

  if (argc < 2) {
    std::cout << "{\"ok\":false,\"reason\":\"missing-command\"}";
    return 2;
  }

  const std::wstring command = argv[1];
  if (command == L"list") {
    std::vector<WindowInfo> windows;
    EnumWindows(enumWindowsProc, reinterpret_cast<LPARAM>(&windows));
    std::cout << "{\"windows\":[";
    for (std::size_t i = 0; i < windows.size(); ++i) {
      if (i) std::cout << ",";
      printWindowJson(windows[i]);
    }
    std::cout << "]}";
    return 0;
  }

  if (argc < 3) {
    printResult(false, "missing-window-id");
    return 3;
  }

  const HWND hwnd = parseHwnd(argv[2]);
  if (!hwnd) {
    printResult(false, "invalid-window-id");
    return 4;
  }

  if (command == L"status") {
    printStatus(hwnd);
    return 0;
  }

  if (command == L"scroll") {
    if (argc < 4) {
      printResult(false, "missing-scroll");
      return 5;
    }
    const int notches = std::clamp(_wtoi(argv[3]), -20, 20);
    printResult(sendMouseWheel(hwnd, notches), targetReady(hwnd) ? "send-input-failed" : "target-not-foreground");
    return 0;
  }

  if (command == L"click") {
    if (argc < 5) {
      printResult(false, "missing-point");
      return 6;
    }
    const int x = _wtoi(argv[3]);
    const int y = _wtoi(argv[4]);
    printResult(sendClick(hwnd, x, y), targetReady(hwnd) ? "send-input-failed" : "target-not-foreground");
    return 0;
  }

  if (command == L"home") {
    printResult(sendHome(hwnd), targetReady(hwnd) ? "send-input-failed" : "target-not-foreground");
    return 0;
  }

  printResult(false, "unknown-command");
  return 7;
}
