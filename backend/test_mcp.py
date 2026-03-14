from mcp_server import mcp
import inspect
app = mcp.streamable_http_app()
print(type(app))
for r in app.routes:
    print(r)
