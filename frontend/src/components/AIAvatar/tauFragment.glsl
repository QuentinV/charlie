precision highp float;

varying vec2 vUv;

uniform float uTime;
uniform float uLow;
uniform float uMid;
uniform float uHigh;

uniform vec3 uCoreColor;
uniform vec3 uRingColor;
uniform vec3 uBeamColor;
uniform vec3 uStripeColor;

uniform float uSensLow;
uniform float uSensMid;
uniform float uSensHigh;
uniform float uUseVignette; // 0.0 or 1.0

mat2 rot(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
}

float ring(vec2 p, float radius, float width) {
    float d = abs(length(p) - radius);
    return smoothstep(width, 0.0, d);
}

// Sharper “edge glow” core
float coreEdge(vec2 p, float radius, float innerWidth, float outerWidth) {
    float d = length(p);
    float inner = smoothstep(radius - innerWidth, radius, d);
    float outer = 1.0 - smoothstep(radius, radius + outerWidth, d);
    return inner * outer;
}

// Signed distance to an equilateral triangle centered at origin
float sdTriangle(vec2 p, float r) {
    // Rotate so the triangle sits flat
    p = rot(3.14159 / 2.0) * p;

    const float k = sqrt(3.0);
    p.x = abs(p.x) - r;
    p.y = p.y + r / k;

    if (p.x + k * p.y > 0.0) {
        p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    }

    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
}

// Soft triangle fill
float triFill(vec2 p, float r, float blur) {
    float d = sdTriangle(p, r);
    return smoothstep(blur, 0.0, -d);
}

// Triangle edge band
float triEdge(vec2 p, float r, float inner, float outer) {
    float d = abs(sdTriangle(p, r));
    float innerBand = smoothstep(inner, 0.0, d);
    float outerBand = 1.0 - smoothstep(0.0, outer, d);
    return innerBand * outerBand;
}

// Sierpinski-style fractal mask
float triFractal(vec2 p, float r, int iterations) {
    // Normalize to triangle space
    p = rot(3.14159 / 2.0) * p;
    p /= r;

    float mask = 1.0;

    for (int i = 0; i < 10; i++) {
        if (i >= iterations) break;

        // Fold into triangle
        if (p.x + p.y > 1.0) p = vec2(1.0 - p.y, 1.0 - p.x);
        p *= 2.0;

        // Remove center triangle
        if (p.x > 1.0 || p.y > 1.0) mask *= 0.0;
    }

    return mask;
}


void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    uv.x *= 1.78;
    float t = uTime * 0.35;
    float r = length(uv);

    float low  = clamp(uLow  * uSensLow,  0.0, 3.0);
    float mid  = clamp(uMid  * uSensMid,  0.0, 3.0);
    float high = clamp(uHigh * uSensHigh, 0.0, 3.0);
    low  = max(0.0, low  - 0.03);
    mid  = max(0.0, mid  - 0.03);
    high = max(0.0, high - 0.03);


    // ---------------------------
    // Darker background + finer grid
    // ---------------------------
    vec2 gridUv = uv * 7.0;
    float gx = abs(fract(gridUv.x) - 0.5);
    float gy = abs(fract(gridUv.y) - 0.5);
    float gridLines = (1.0 - smoothstep(0.0, 0.012, gx)) *
                      (1.0 - smoothstep(0.0, 0.012, gy));
    float gridFade = smoothstep(1.3, 0.3, r);
    float bgFactor = gridLines * 0.06 * gridFade;

    vec3 color = vec3(0.0); // start fully transparent

    // ---------------------------
    // TAU-style double triangle core (no fractal)
    // ---------------------------  

    // Base rotation
    vec2 triP = uv;

    vec2 triOuterP = triP * rot(t * (0.25 + low * 0.4));
    vec2 triInnerP = triP * rot(-t * (0.35 + high * 0.6));


    // Stronger audio-reactive breathing
    float triR1 = 0.23 
        + low * 0.10        // bass expands the outer triangle
        + mid * 0.04        // mids add subtle wobble
        + 0.02 * sin(t * 2.0 + low * 3.0);

    float triR2 = triR1 * (0.50 + high * 0.10); // highs expand the inner triangle

    // Outer triangle
    float outerFill  = triFill(triOuterP, triR1, 0.15);
    float outerEdge = triEdge(triOuterP, triR1, 0.03 + mid * 0.02, 0.06 + high * 0.03);
    float outerCore  = outerFill * 0.7 + outerEdge * 1.4;

    // Inner triangle
    float innerFill  = triFill(triInnerP, triR2, 0.12);
    float innerEdge = triEdge(triInnerP, triR2, 0.025 + mid * 0.015, 0.05 + high * 0.02);
    float innerCore  = innerFill * 0.8 + innerEdge * 1.6;

    // Combine both triangles
    float triCore = outerCore * 0.9 + innerCore * 1.2;
    triCore = mix(triCore, triCore * 0.5 + 0.5, 0.3);

    // Add to color
    color += uCoreColor * triCore * (0.15 + low * 0.15);

    // ---------------------------
    // Concentric rings with gaps
    // ---------------------------
    float ringBase = 0.30 + low * 0.03;
    float ringLayer = 0.0;

    for (int i = 0; i < 8; i++) {
        float idx = float(i);
        float rr = ringBase + idx * 0.11;

        // Slight breathing / offset
        rr += 0.008 * sin(t * 1.7 + idx * 0.9 + mid * 2.0);

        // Base ring
        float baseRing = ring(uv, rr, 0.012 + mid * 0.006);

        // Add gaps by modulating with angle
        float angle = atan(uv.y, uv.x);
        float gapPattern = 0.5 + 0.5 * cos(angle * (6.0 + idx * 1.5) + idx);
        float gapMask = smoothstep(0.3, 0.8, gapPattern);

        ringLayer += baseRing * gapMask;
    }

    ringLayer = clamp(ringLayer, 0.0, 2.0);
    color += uRingColor * ringLayer * (0.5 + mid * 1.4);

    // ---------------------------
    // Radial beams (sharper, more “AI”)
    // ---------------------------
    float angle = atan(uv.y, uv.x);
    float beamCount = 22.0 + high * 18.0;

    // Base beam pattern
    float beamPattern = abs(sin(angle * beamCount + t * 2.5));
    float beams = smoothstep(0.22, 0.0, beamPattern);

    // Restrict to a ring band
    float beamBand = smoothstep(0.35, 0.8, r) * (1.0 - smoothstep(1.1, 1.6, r));
    beams *= beamBand;

    color += uBeamColor * beams * (0.35 + high * 2.0);

    // ---------------------------
    // Inner stripes (data lines)
    // ---------------------------
    //vec2 su = uv * rot(t * 0.35);
    //float stripesPattern = abs(sin(su.x * (7.0 + mid * 3.0) + t));
    //float stripes = smoothstep(0.28, 0.0, stripesPattern);
    //stripes *= smoothstep(0.0, 0.55, r) * (1.0 - smoothstep(0.55, 1.05, r));

    //color += uStripeColor * stripes * (0.22 + mid * 1.0);

    // ---------------------------
    // Subtle outer halo (fake bloom-ish)
    // ---------------------------
    float outerGlow = smoothstep(0.5, 1.4, r);
    outerGlow = 1.0 - outerGlow;
    outerGlow = clamp(outerGlow, 0.0, 1.0);
    color += uCoreColor * outerGlow * 0.15;

    // ---------------------------
    // Vignette
    // ---------------------------
    if (uUseVignette > 0.5) {
        float v = smoothstep(1.5, 0.35, r);
        color *= v;
    }

    // Mild tone mapping
    color = 1.0 - exp(-color * 1.1);

    gl_FragColor = vec4(color, 0.0);
}
