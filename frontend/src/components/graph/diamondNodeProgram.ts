import { NodeCircleProgram } from "sigma/rendering";

const DIAMOND_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;
uniform float u_correctionRatio;
const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);
void main(void) {
  float border = u_correctionRatio * 2.0;
  float dist = (abs(v_diffVector.x) + abs(v_diffVector.y)) - v_radius + border;
  #ifdef PICKING_MODE
  if (dist > border) gl_FragColor = transparent;
  else gl_FragColor = v_color;
  #else
  float t = 0.0;
  if (dist > border) t = 1.0;
  else if (dist > 0.0) t = dist / border;
  gl_FragColor = mix(v_color, transparent, t);
  #endif
}
`;

export class NodeDiamondProgram extends NodeCircleProgram {
	getDefinition() {
		const def = super.getDefinition();
		return { ...def, FRAGMENT_SHADER_SOURCE: DIAMOND_FRAGMENT_SHADER };
	}
}
