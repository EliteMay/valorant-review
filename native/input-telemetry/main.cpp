#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0601
#include <windows.h>

#include <algorithm>
#include <cstdint>
#include <cwctype>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

namespace {
constexpr wchar_t kWindowClass[] = L"VReviewInputTelemetryWindow";
constexpr char kHelperVersion[] = "0.1.0";

HWND g_window = nullptr;
LARGE_INTEGER g_frequency{};
ULONGLONG g_lastForegroundCheckMs = 0;
bool g_valorantForeground = false;
std::wstring g_foregroundProcess;
bool g_keyState[256]{};

std::uint64_t nowMicroseconds() {
  LARGE_INTEGER counter{};
  QueryPerformanceCounter(&counter);
  const long double micros =
      (static_cast<long double>(counter.QuadPart) * 1000000.0L) /
      static_cast<long double>(g_frequency.QuadPart);
  return static_cast<std::uint64_t>(micros);
}

std::string wideToUtf8(const std::wstring& value) {
  if (value.empty()) return {};
  const int size = WideCharToMultiByte(CP_UTF8, 0, value.data(),
                                       static_cast<int>(value.size()),
                                       nullptr, 0, nullptr, nullptr);
  if (size <= 0) return {};
  std::string output(static_cast<std::size_t>(size), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.data(),
                      static_cast<int>(value.size()),
                      output.data(), size, nullptr, nullptr);
  return output;
}

std::string jsonEscape(const std::string& value) {
  std::string output;
  output.reserve(value.size() + 8);
  for (unsigned char ch : value) {
    switch (ch) {
      case '"': output += "\\\""; break;
      case '\\': output += "\\\\"; break;
      case '\b': output += "\\b"; break;
      case '\f': output += "\\f"; break;
      case '\n': output += "\\n"; break;
      case '\r': output += "\\r"; break;
      case '\t': output += "\\t"; break;
      default:
        if (ch < 0x20) {
          const char hex[] = "0123456789abcdef";
          output += "\\u00";
          output += hex[(ch >> 4) & 0x0f];
          output += hex[ch & 0x0f];
        } else {
          output.push_back(static_cast<char>(ch));
        }
    }
  }
  return output;
}

void emitLine(const std::string& line) {
  std::cout << line << std::endl;
}

std::wstring basenameOf(const std::wstring& path) {
  const auto pos = path.find_last_of(L"\\/");
  return pos == std::wstring::npos ? path : path.substr(pos + 1);
}

std::wstring lower(const std::wstring& value) {
  std::wstring result = value;
  std::transform(result.begin(), result.end(), result.begin(),
                 [](wchar_t ch) { return static_cast<wchar_t>(std::towlower(ch)); });
  return result;
}

std::wstring foregroundProcessName() {
  const HWND foreground = GetForegroundWindow();
  if (!foreground) return {};

  DWORD processId = 0;
  GetWindowThreadProcessId(foreground, &processId);
  if (!processId) return {};

  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId);
  if (!process) return {};

  std::vector<wchar_t> buffer(32768);
  DWORD size = static_cast<DWORD>(buffer.size());
  std::wstring result;
  if (QueryFullProcessImageNameW(process, 0, buffer.data(), &size) && size > 0) {
    result.assign(buffer.data(), size);
    result = basenameOf(result);
  }

  CloseHandle(process);
  return result;
}

bool isValorantProcess(const std::wstring& processName) {
  const std::wstring name = lower(processName);
  return name == L"valorant-win64-shipping.exe" || name == L"valorant.exe";
}

void refreshForeground(bool force = false) {
  const ULONGLONG now = GetTickCount64();
  if (!force && now - g_lastForegroundCheckMs < 100) return;
  g_lastForegroundCheckMs = now;

  const std::wstring process = foregroundProcessName();
  const bool valorant = isValorantProcess(process);
  if (valorant == g_valorantForeground && process == g_foregroundProcess) return;

  g_valorantForeground = valorant;
  g_foregroundProcess = process;

  const std::string processUtf8 = jsonEscape(wideToUtf8(process));
  emitLine(
      "{\"type\":\"focus\",\"t_us\":" + std::to_string(nowMicroseconds()) +
      ",\"valorant\":" + std::string(valorant ? "true" : "false") +
      ",\"process\":\"" + processUtf8 + "\"}");
}

void emitMouse(LONG dx, LONG dy) {
  if (dx == 0 && dy == 0) return;
  emitLine(
      "{\"type\":\"mouse\",\"t_us\":" + std::to_string(nowMicroseconds()) +
      ",\"dx\":" + std::to_string(dx) +
      ",\"dy\":" + std::to_string(dy) + "}");
}

void emitButton(const char* state) {
  emitLine(
      "{\"type\":\"button\",\"t_us\":" + std::to_string(nowMicroseconds()) +
      ",\"button\":\"LMB\",\"state\":\"" + state + "\"}");
}

void emitKey(USHORT vkey, bool down) {
  if (vkey >= 256) return;
  if (down == g_keyState[vkey]) return;
  g_keyState[vkey] = down;

  char key = '\0';
  switch (vkey) {
    case 'W': key = 'W'; break;
    case 'A': key = 'A'; break;
    case 'S': key = 'S'; break;
    case 'D': key = 'D'; break;
    default: return;
  }

  emitLine(
      "{\"type\":\"key\",\"t_us\":" + std::to_string(nowMicroseconds()) +
      ",\"key\":\"" + std::string(1, key) +
      "\",\"state\":\"" + (down ? "down" : "up") + "\"}");
}

void handleRawInput(HRAWINPUT inputHandle) {
  UINT size = 0;
  if (GetRawInputData(inputHandle, RID_INPUT, nullptr, &size,
                      sizeof(RAWINPUTHEADER)) != 0 ||
      size == 0) {
    return;
  }

  std::vector<BYTE> buffer(size);
  if (GetRawInputData(inputHandle, RID_INPUT, buffer.data(), &size,
                      sizeof(RAWINPUTHEADER)) != size) {
    return;
  }

  refreshForeground();
  if (!g_valorantForeground) return;

  const RAWINPUT* input = reinterpret_cast<const RAWINPUT*>(buffer.data());
  if (input->header.dwType == RIM_TYPEMOUSE) {
    const RAWMOUSE& mouse = input->data.mouse;
    emitMouse(mouse.lLastX, mouse.lLastY);

    const USHORT flags = mouse.usButtonFlags;
    if (flags & RI_MOUSE_LEFT_BUTTON_DOWN) emitButton("down");
    if (flags & RI_MOUSE_LEFT_BUTTON_UP) emitButton("up");
  } else if (input->header.dwType == RIM_TYPEKEYBOARD) {
    const RAWKEYBOARD& keyboard = input->data.keyboard;
    const bool down = (keyboard.Flags & RI_KEY_BREAK) == 0;
    emitKey(keyboard.VKey, down);
  }
}

LRESULT CALLBACK windowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
  switch (message) {
    case WM_INPUT:
      handleRawInput(reinterpret_cast<HRAWINPUT>(lParam));
      return 0;
    case WM_TIMER:
      refreshForeground(true);
      return 0;
    case WM_CLOSE:
      DestroyWindow(hwnd);
      return 0;
    case WM_DESTROY:
      KillTimer(hwnd, 1);
      PostQuitMessage(0);
      return 0;
    default:
      return DefWindowProcW(hwnd, message, wParam, lParam);
  }
}

bool registerRawInput(HWND hwnd) {
  RAWINPUTDEVICE devices[2]{};

  devices[0].usUsagePage = 0x01;
  devices[0].usUsage = 0x02;
  devices[0].dwFlags = RIDEV_INPUTSINK;
  devices[0].hwndTarget = hwnd;

  devices[1].usUsagePage = 0x01;
  devices[1].usUsage = 0x06;
  devices[1].dwFlags = RIDEV_INPUTSINK;
  devices[1].hwndTarget = hwnd;

  return RegisterRawInputDevices(devices, 2, sizeof(RAWINPUTDEVICE)) == TRUE;
}
}  // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
  QueryPerformanceFrequency(&g_frequency);
  if (g_frequency.QuadPart <= 0) return 10;

  std::ios::sync_with_stdio(false);
  SetConsoleOutputCP(CP_UTF8);

  WNDCLASSEXW windowClass{};
  windowClass.cbSize = sizeof(windowClass);
  windowClass.lpfnWndProc = windowProc;
  windowClass.hInstance = instance;
  windowClass.lpszClassName = kWindowClass;

  if (!RegisterClassExW(&windowClass)) return 11;

  g_window = CreateWindowExW(
      0, kWindowClass, L"VReview Input Telemetry", WS_OVERLAPPED,
      0, 0, 0, 0, nullptr, nullptr, instance, nullptr);
  if (!g_window) return 12;

  if (!registerRawInput(g_window)) {
    DestroyWindow(g_window);
    return 13;
  }

  SetTimer(g_window, 1, 250, nullptr);

  emitLine(
      "{\"type\":\"ready\",\"t_us\":" + std::to_string(nowMicroseconds()) +
      ",\"helperVersion\":\"" + kHelperVersion +
      "\",\"qpcFrequency\":" + std::to_string(g_frequency.QuadPart) + "}");

  refreshForeground(true);

  std::thread([] {
    std::string command;
    while (std::getline(std::cin, command)) {
      if (command == "quit" || command == "stop") {
        if (g_window) PostMessageW(g_window, WM_CLOSE, 0, 0);
        break;
      }
    }
  }).detach();

  MSG message{};
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }

  emitLine(
      "{\"type\":\"stopped\",\"t_us\":" + std::to_string(nowMicroseconds()) + "}");
  return 0;
}
