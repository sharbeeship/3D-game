const Gltf = (() => {
  const COMPONENT_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT3: 9, MAT4: 16 };

  async function load(url, gl) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load ${url} (${response.status})`);
    }

    const buffer = await response.arrayBuffer();
    const json = parseGlb(buffer);
    return upload(gl, json);
  }

  function parseGlb(buffer) {
    const header = new DataView(buffer, 0, 12);
    if (header.getUint32(0, true) !== 0x46546c67) {
      throw new Error("Not a GLB file.");
    }

    let offset = 12;
    let json = null;
    let bin = null;

    while (offset < buffer.byteLength) {
      const view = new DataView(buffer, offset, 8);
      const chunkLength = view.getUint32(0, true);
      const chunkType = view.getUint32(4, true);
      const start = offset + 8;
      if (chunkType === 0x4e4f534a) {
        json = JSON.parse(new TextDecoder().decode(buffer.slice(start, start + chunkLength)));
      } else if (chunkType === 0x004e4942) {
        bin = buffer.slice(start, start + chunkLength);
      }
      offset = start + chunkLength;
    }

    if (!json || !bin) {
      throw new Error("GLB is missing JSON or BIN chunk.");
    }

    json.__bin = bin;
    return json;
  }

  function accessorBytes(json, accessorIndex) {
    const accessor = json.accessors[accessorIndex];
    const view = json.bufferViews[accessor.bufferView];
    const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
    const count = accessor.count * TYPE_COUNT[accessor.type];
    const size = COMPONENT_SIZE[accessor.componentType];
    return { accessor, bytes: json.__bin.slice(start, start + count * size) };
  }

  function typedArray(componentType, bytes) {
    if (componentType === 5126) return new Float32Array(bytes);
    if (componentType === 5123) return new Uint16Array(bytes);
    if (componentType === 5125) return new Uint32Array(bytes);
    if (componentType === 5121) return new Uint8Array(bytes);
    throw new Error(`Unsupported accessor type ${componentType}`);
  }

  async function imageFromView(json, image) {
    const view = json.bufferViews[image.bufferView];
    const bytes = json.__bin.slice(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    const blob = new Blob([bytes], { type: image.mimeType || "image/png" });
    const url = URL.createObjectURL(blob);
    try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    if (img.decode) {
      await img.decode();
    } else {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("Image failed to decode"));
      });
    }
    return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function createTexture(gl, image, srgb) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    texture.__srgb = srgb;
    return texture;
  }

  function solidTexture(gl, r, g, b, a) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([r, g, b, a]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return texture;
  }

  async function upload(gl, json) {
    const images = [];
    for (const image of json.images || []) {
      images.push(await imageFromView(json, image));
    }

    const textures = (json.textures || []).map((texture) => createTexture(gl, images[texture.source], true));
    const white = solidTexture(gl, 255, 255, 255, 255);
    const flatNormal = solidTexture(gl, 128, 128, 255, 255);
    const defaultMr = solidTexture(gl, 0, 200, 40, 255);

    const primitives = [];
    const scene = json.scenes[json.scene || 0];

    function walk(nodeIndex, parent) {
      const node = json.nodes[nodeIndex];
      const local = nodeMatrix(node);
      const world = multiply4(parent, local);
      if (node.mesh !== undefined) {
        const mesh = json.meshes[node.mesh];
        for (const primitive of mesh.primitives) {
          primitives.push(gpuPrimitive(gl, json, primitive, textures, white, flatNormal, defaultMr, world));
        }
      }
      for (const child of node.children || []) {
        walk(child, world);
      }
    }

    for (const nodeIndex of scene.nodes) {
      walk(nodeIndex, identity4());
    }

    return { primitives };
  }

  function gpuPrimitive(gl, json, primitive, textures, white, flatNormal, defaultMr, world) {
    const position = typedArray(5126, accessorBytes(json, primitive.attributes.POSITION).bytes);
    const normal = primitive.attributes.NORMAL !== undefined
      ? typedArray(5126, accessorBytes(json, primitive.attributes.NORMAL).bytes)
      : new Float32Array(position.length);
    const uv = primitive.attributes.TEXCOORD_0 !== undefined
      ? typedArray(5126, accessorBytes(json, primitive.attributes.TEXCOORD_0).bytes)
      : new Float32Array((position.length / 3) * 2);
    const tangent = primitive.attributes.TANGENT !== undefined
      ? typedArray(5126, accessorBytes(json, primitive.attributes.TANGENT).bytes)
      : new Float32Array((position.length / 3) * 4);
    const indices = primitive.indices !== undefined
      ? typedArray(accessorBytes(json, primitive.indices).accessor.componentType, accessorBytes(json, primitive.indices).bytes)
      : null;

    const material = json.materials?.[primitive.material] || {};
    const pbr = material.pbrMetallicRoughness || {};
    const baseMap = pbr.baseColorTexture ? textures[pbr.baseColorTexture.index] : white;
    const mrMap = pbr.metallicRoughnessTexture ? textures[pbr.metallicRoughnessTexture.index] : defaultMr;
    const normalMap = material.normalTexture ? textures[material.normalTexture.index] : flatNormal;

    const vbo = gl.createBuffer();
    const packed = packVertices(position, normal, uv, tangent);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, packed, gl.STATIC_DRAW);

    let ibo = null;
    let count = position.length / 3;
    let indexType = gl.UNSIGNED_SHORT;
    if (indices) {
      ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      count = indices.length;
      indexType = indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    }

    return {
      vbo,
      ibo,
      count,
      indexType,
      stride: 12 * 4,
      world,
      baseMap,
      mrMap,
      normalMap,
      baseColorFactor: pbr.baseColorFactor || [1, 1, 1, 1],
      metallicFactor: pbr.metallicFactor ?? 1,
      roughnessFactor: pbr.roughnessFactor ?? 1,
    };
  }

  function packVertices(position, normal, uv, tangent) {
    const count = position.length / 3;
    const packed = new Float32Array(count * 12);
    for (let i = 0; i < count; i += 1) {
      const o = i * 12;
      packed[o] = position[i * 3];
      packed[o + 1] = position[i * 3 + 1];
      packed[o + 2] = position[i * 3 + 2];
      packed[o + 3] = normal[i * 3] || 0;
      packed[o + 4] = normal[i * 3 + 1] || 1;
      packed[o + 5] = normal[i * 3 + 2] || 0;
      packed[o + 6] = uv[i * 2] || 0;
      packed[o + 7] = uv[i * 2 + 1] || 0;
      packed[o + 8] = tangent[i * 4] || 1;
      packed[o + 9] = tangent[i * 4 + 1] || 0;
      packed[o + 10] = tangent[i * 4 + 2] || 0;
      packed[o + 11] = tangent[i * 4 + 3] || 1;
    }
    return packed;
  }

  function nodeMatrix(node) {
    if (node.matrix) return new Float32Array(node.matrix);
    const t = node.translation || [0, 0, 0];
    const r = node.rotation || [0, 0, 0, 1];
    const s = node.scale || [1, 1, 1];
    return composeTrs(t, r, s);
  }

  function composeTrs(t, q, s) {
    const [x, y, z, w] = q;
    const xx = x * x;
    const yy = y * y;
    const zz = z * z;
    const xy = x * y;
    const xz = x * z;
    const yz = y * z;
    const wx = w * x;
    const wy = w * y;
    const wz = w * z;
    return new Float32Array([
      (1 - 2 * (yy + zz)) * s[0],
      (2 * (xy + wz)) * s[0],
      (2 * (xz - wy)) * s[0],
      0,
      (2 * (xy - wz)) * s[1],
      (1 - 2 * (xx + zz)) * s[1],
      (2 * (yz + wx)) * s[1],
      0,
      (2 * (xz + wy)) * s[2],
      (2 * (yz - wx)) * s[2],
      (1 - 2 * (xx + yy)) * s[2],
      0,
      t[0],
      t[1],
      t[2],
      1,
    ]);
  }

  function identity4() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }

  function multiply4(a, b) {
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        out[column * 4 + row] =
          a[0 * 4 + row] * b[column * 4 + 0] +
          a[1 * 4 + row] * b[column * 4 + 1] +
          a[2 * 4 + row] * b[column * 4 + 2] +
          a[3 * 4 + row] * b[column * 4 + 3];
      }
    }
    return out;
  }

  return { load, multiply4, identity4 };
})();
