import React, { Suspense, useRef, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { useThemeStore } from '../../store/themeStore';

const LIGHT_SQ = '#F0D9B5';
const DARK_SQ  = '#B58863';

const BOARD_ORIGIN = [6.5, 0.5, -5.5];

const AnimatedSquareWrapper = ({ index, basePosition, color, isDark }) => {
  const meshRef       = useRef();
  const ringRef       = useRef();
  const [hovered, setHovered] = useState(false);
  const emissiveColor = useRef(new THREE.Color(color));
  const goldColor     = useMemo(() => new THREE.Color('#D4AF37'), []);
  const baseColor     = useMemo(() => new THREE.Color(color), [color]);

  useFrame((state) => {
    if (!meshRef.current?.parent) return;
    const offset = meshRef.current.parent.userData.scrollOffset || 0;

    const explosion = offset < 0.5 ? offset * 4 : (1 - offset) * 4;
    const row  = Math.floor(index / 8);
    const col  = index % 8;
    const dirY = (row + col) % 2 === 0 ? 1 : -1;
    const dirX = (col - 3.5) * 0.4;
    const dirZ = (row - 3.5) * 0.4;

    let tx = basePosition[0] + dirX * explosion;
    let ty = basePosition[1] + dirY * explosion * 3 + (hovered ? 0.75 : 0);
    let tz = basePosition[2] + dirZ * explosion;

    if (offset > 0.4) {
      const angle  = offset * Math.PI * 4;
      const radius = Math.sqrt(tx * tx + tz * tz);
      const ca     = Math.atan2(tz, tx);
      tx = Math.cos(ca + angle) * radius;
      tz = Math.sin(ca + angle) * radius;
    }

    meshRef.current.position.lerp(new THREE.Vector3(tx, ty, tz), 0.12);
    meshRef.current.rotation.x = THREE.MathUtils.lerp(0, dirY * explosion * 0.5, 0.12);
    meshRef.current.rotation.z = THREE.MathUtils.lerp(0, dirX * explosion * 0.5, 0.12);

    emissiveColor.current.lerp(hovered ? goldColor : baseColor, 0.12);
    meshRef.current.material.emissive.copy(emissiveColor.current);
    const targetIntensity = hovered ? 0.55 : isDark ? 0.05 : 0.12;
    meshRef.current.material.emissiveIntensity = THREE.MathUtils.lerp(
      meshRef.current.material.emissiveIntensity, targetIntensity, 0.12
    );

    if (ringRef.current) {
      ringRef.current.material.opacity = THREE.MathUtils.lerp(
        ringRef.current.material.opacity, hovered ? 0.75 : 0, 0.12
      );
      if (hovered) {
        const pulse = 1.0 + Math.sin(state.clock.elapsedTime * 6) * 0.12;
        ringRef.current.scale.setScalar(pulse);
      } else {
        ringRef.current.scale.setScalar(1);
      }
    }
  });

  return (
    <mesh
      ref={meshRef}
      position={basePosition}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true);  }}
      onPointerOut={(e)  => { e.stopPropagation(); setHovered(false); }}
    >
      <boxGeometry args={[0.95, 0.15, 0.95]} />
      <meshStandardMaterial
        color={color} roughness={0.8} metalness={0.02}
        emissive={color} emissiveIntensity={isDark ? 0.05 : 0.12}
      />
      <mesh ref={ringRef} position={[0, 0.13, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.38, 0.5, 40]} />
        <meshBasicMaterial color="#D4AF37" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </mesh>
  );
};

const ProceduralChessboard = () => {
  const groupRef = useRef();

  const squares = useMemo(() => {
    const sqs = [];
    for (let i = 0; i < 64; i++) {
      const row    = Math.floor(i / 8);
      const col    = i % 8;
      const isDark = (row + col) % 2 === 1;
      sqs.push(
        <AnimatedSquareWrapper
          key={i} index={i}
          basePosition={[col - 3.5, 0, row - 3.5]}
          color={isDark ? DARK_SQ : LIGHT_SQ}
          isDark={isDark}
        />
      );
    }
    return sqs;
  }, []);

  useFrame((state) => {
    if (!groupRef.current) return;
    const scrollY   = window.scrollY;
    const maxScroll = document.body.scrollHeight - window.innerHeight;
    const offset    = maxScroll > 0 ? Math.min(1, Math.max(0, scrollY / maxScroll)) : 0;

    groupRef.current.children.forEach((c) => { c.userData.scrollOffset = offset; });

    const targetRotY = state.clock.elapsedTime * 0.15 + offset * Math.PI + state.pointer.x * 0.3;
    const targetRotX = THREE.MathUtils.lerp(Math.PI / 6, Math.PI / 2, offset) - state.pointer.y * 0.2;
    
    const targetPosX = THREE.MathUtils.lerp(BOARD_ORIGIN[0], 0, offset);
    const targetPosY = THREE.MathUtils.lerp(BOARD_ORIGIN[1], 0.5, offset);
    const targetPosZ = THREE.MathUtils.lerp(BOARD_ORIGIN[2], -3.5, offset);

    groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, targetRotY, 0.05);
    groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, targetRotX, 0.05);
    
    groupRef.current.position.x = THREE.MathUtils.lerp(groupRef.current.position.x, targetPosX, 0.05);
    groupRef.current.position.y = THREE.MathUtils.lerp(groupRef.current.position.y, targetPosY, 0.05);
    groupRef.current.position.z = THREE.MathUtils.lerp(groupRef.current.position.z, targetPosZ, 0.05);
    
    const targetScale = THREE.MathUtils.lerp(1, 1.75, offset);
    groupRef.current.scale.setScalar(THREE.MathUtils.lerp(groupRef.current.scale.x || 1, targetScale, 0.05));
  });

  return (
    <group ref={groupRef} position={BOARD_ORIGIN}>
      <mesh position={[0, -0.525, 0]}>
        <boxGeometry args={[8.4, 0.6, 8.4]} />
        <meshStandardMaterial color="#1C1008" roughness={0.9} metalness={0.3} />
      </mesh>
      <mesh position={[0, -0.15, 0]}>
        <boxGeometry args={[8.6, 0.15, 8.6]} />
        <meshStandardMaterial color="#D4AF37" roughness={0.3} metalness={0.8} emissive="#D4AF37" emissiveIntensity={0.2} />
      </mesh>

      {squares}
    </group>
  );
};

useGLTF.preload('/models/chess.glb');

const InnerScene = ({ isDark }) => {
  const location  = useLocation();
  const isHome    = location.pathname === '/';
  useGLTF('/models/chess.glb');
  return (
    <>
      <ambientLight intensity={isDark ? 0.6 : 0.8} color="#FFF4E0" />
      <pointLight position={[ 8,  12,  6]} intensity={isDark ? 2.8 : 2.0} color="#FFD580" />
      <pointLight position={[-10,  5,  4]} intensity={isDark ? 1.5 : 1.0} color="#FF9A3C" />

      <fog attach="fog" args={[isDark ? '#181110' : '#EAD5A8', 10, 45]} />

      <Sparkles 
        position={[0, 0, -15]}
        count={400} scale={[60, 45, 10]} 
        size={isDark ? 3.5 : 4.5} 
        speed={0.15} 
        color={isDark ? "#D4AF37" : "#5C1800"} 
        opacity={isDark ? 0.65 : 0.7} 
      />
      <Sparkles 
        position={[0, 0, -12]}
        count={250} scale={[50, 40, 10]} 
        size={isDark ? 2.5 : 3.5} 
        speed={0.25} 
        color={isDark ? "#FFF4E0" : "#1C1008"} 
        opacity={isDark ? 0.8 : 0.6} 
      />

      {isHome && <ProceduralChessboard />}

    </>
  );
};

class SceneErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

export const GlobalCanvas = () => {
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      width: '100%', height: '100dvh',
      zIndex: -1,
      background: isDark ? `
        radial-gradient(ellipse at 72% 58%, rgba(212,175,55,0.08) 0%, transparent 60%),
        radial-gradient(ellipse at 18% 28%, rgba(139,37,0,0.12) 0%, transparent 55%),
        linear-gradient(160deg, #181110 0%, #0d0806 45%, #050302 100%)
      ` : `
        radial-gradient(ellipse at 72% 58%, rgba(200,160,80,0.18) 0%, transparent 60%),
        radial-gradient(ellipse at 18% 28%, rgba(180,120,60,0.12) 0%, transparent 55%),
        linear-gradient(160deg, #F5EDD8 0%, #EDE0C4 45%, #E4D0A0 100%)
      `,
    }}>
      <Canvas
        camera={{ position: [0, 0, 10], fov: 60 }}
        eventSource={document.getElementById('root')}
        eventPrefix="client"
      >
        <Suspense fallback={null}>
          <SceneErrorBoundary>
            <InnerScene isDark={isDark} />
          </SceneErrorBoundary>
        </Suspense>
      </Canvas>
    </div>
  );
};
