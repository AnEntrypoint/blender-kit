'use strict';
const BRIDGE_RENDER_GET = `
            elif self.path == "/render/status":
                self.send_json(200, {"rendering": bpy.app.is_job_running("RENDER")})
`;

const BRIDGE_RENDER_POST = `
            elif self.path == "/render":
                output_path = body.get("output_path")
                frame = body.get("frame")
                animation = body.get("animation", False)
                if output_path:
                    bpy.context.scene.render.filepath = output_path
                if frame is not None:
                    bpy.context.scene.frame_set(frame)
                def _do_render():
                    bpy.ops.render.render(animation=animation, write_still=not animation)
                    return None
                bpy.app.timers.register(_do_render, first_interval=0)
                self.send_json(200, {"status": "started", "frame": bpy.context.scene.frame_current})
`;
module.exports = { BRIDGE_RENDER_GET, BRIDGE_RENDER_POST };
