import unittest

from fastapi import FastAPI

from run_desktop import WindowBridge, register_shell_routes


class StubBridge:
    def __init__(self, maximized=True):
        self.calls = []
        self._maximized = maximized

    def is_maximized(self):
        return self._maximized

    def minimize(self):
        self.calls.append("minimize")

    def toggle_maximize(self):
        self._maximized = not self._maximized
        self.calls.append("toggle_maximize")
        return self._maximized

    def start_drag(self):
        self.calls.append("start_drag")

    def start_resize(self, edge="se"):
        self.calls.append(f"start_resize:{edge}")

    def close(self):
        self.calls.append("close")


def find_endpoint(application, path, method):
    for route in application.routes:
        if getattr(route, "path", None) == path and method in route.methods:
            return route.endpoint

    return None


def resolve_route(application, path, method):
    # Order-sensitive resolution, the way Starlette actually dispatches.
    from starlette.routing import Match

    scope = {"type": "http", "path": path, "method": method}

    for route in application.router.routes:
        match, _ = route.matches(scope)

        if match == Match.FULL:
            return route

    return None


class ShellWindowRouteTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.bridge = StubBridge(maximized=True)
        register_shell_routes(self.app, self.bridge)

    def call(self, path, method="POST"):
        endpoint = find_endpoint(self.app, path, method)
        self.assertIsNotNone(endpoint, f"missing route {method} {path}")
        return endpoint()

    def test_state_reports_maximized_and_platform(self):
        state = self.call("/shell/window/state", "GET")

        self.assertTrue(state["maximized"])
        self.assertIn(state["platform"], ("windows", "gtk"))

    def test_start_resize_forwards_the_edge(self):
        endpoint = find_endpoint(
            self.app, "/shell/window/start-resize", "POST"
        )
        endpoint(edge="nw")

        self.assertEqual(self.bridge.calls, ["start_resize:nw"])

    def test_toggle_maximize_flips_and_returns_state(self):
        self.assertEqual(
            self.call("/shell/window/toggle-maximize"), {"maximized": False}
        )
        self.assertEqual(
            self.call("/shell/window/toggle-maximize"), {"maximized": True}
        )

    def test_shell_routes_win_over_a_preexisting_spa_catch_all(self):
        # main.py registers GET /{full_path:path} for the SPA before the
        # launcher adds the shell routes; the state route must still resolve.
        app = FastAPI()

        @app.get("/{full_path:path}")
        def spa_catch_all(full_path: str):
            return "index.html"

        register_shell_routes(app, StubBridge())
        route = resolve_route(app, "/shell/window/state", "GET")

        self.assertIsNotNone(route)
        self.assertEqual(route.path, "/shell/window/state")

    def test_actions_reach_the_bridge(self):
        self.call("/shell/window/minimize")
        self.call("/shell/window/start-drag")
        self.call("/shell/window/start-resize")
        self.call("/shell/window/close")

        self.assertEqual(
            self.bridge.calls,
            ["minimize", "start_drag", "start_resize:se", "close"],
        )


class WindowBridgeGuardTests(unittest.TestCase):
    def test_bridge_without_window_never_crashes(self):
        # HTTP routes are live before the native window exists; every action
        # must be a safe no-op in that gap.
        bridge = WindowBridge(maximized=True)

        bridge.minimize()
        bridge.start_drag()
        bridge.start_resize()
        bridge.close()

        self.assertTrue(bridge.is_maximized())
        self.assertTrue(bridge.toggle_maximize())


if __name__ == "__main__":
    unittest.main()
