const si = require('systeminformation');

/**
 * System Monitor
 * Tracks CPU, RAM, and other system statistics
 */
class SystemMonitor {
    constructor(eventEmitter) {
        this.eventEmitter = eventEmitter;
        this.isMonitoring = false;
        this.monitoringInterval = null;
        this.updateInterval = 1000; // Default 1 second
        
        // Cache for system stats
        this.lastStats = {
            cpu: 0,
            memory: 0,
            timestamp: Date.now()
        };
        
        // Performance optimization
        this.cpuLoadArray = [];
        this.maxCpuSamples = 5; // Keep last 5 samples for smoothing
        
        console.log('System Monitor initialized');
    }

    /**
     * Start system monitoring
     */
    async startMonitoring(interval = 1000) {
        try {
            if (this.isMonitoring) {
                console.log('System monitoring already running');
                return { success: true };
            }

            this.updateInterval = interval;
            console.log(`Starting system monitoring with ${interval}ms interval`);

            // Get initial system info
            await this.updateSystemStats();

            // Start monitoring loop
            this.monitoringInterval = setInterval(async () => {
                try {
                    await this.updateSystemStats();
                } catch (error) {
                    console.error('Error in monitoring loop:', error);
                }
            }, this.updateInterval);

            this.isMonitoring = true;
            console.log('System monitoring started successfully');
            
            return { success: true };

        } catch (error) {
            console.error('Failed to start system monitoring:', error);
            throw new Error(`Monitoring start failed: ${error.message}`);
        }
    }

    /**
     * Stop system monitoring
     */
    stopMonitoring() {
        try {
            if (!this.isMonitoring) {
                console.log('System monitoring not running');
                return { success: true };
            }

            if (this.monitoringInterval) {
                clearInterval(this.monitoringInterval);
                this.monitoringInterval = null;
            }

            this.isMonitoring = false;
            this.cpuLoadArray = [];
            
            console.log('System monitoring stopped');
            return { success: true };

        } catch (error) {
            console.error('Failed to stop system monitoring:', error);
            throw new Error(`Monitoring stop failed: ${error.message}`);
        }
    }

    /**
     * Update system statistics
     */
    async updateSystemStats() {
        try {
            // Get CPU usage (with interval for accuracy)
            const cpuLoad = await si.currentLoad();
            const cpuUsage = cpuLoad.currentLoad || 0;

            // Get memory usage
            const memoryInfo = await si.mem();

            // Calculate memory usage correctly based on platform
            // On macOS, "used" includes cached files that can be freed, so we use "active" or (total - available)
            // On other platforms, we use the standard calculation
            let memoryUsage;

            if (process.platform === 'darwin' && memoryInfo.active !== undefined) {
                // macOS: Use active memory (memory actively used by apps)
                memoryUsage = ((memoryInfo.active / memoryInfo.total) * 100) || 0;
            } else if (memoryInfo.available !== undefined) {
                // Alternative: Use (total - available) / total
                memoryUsage = (((memoryInfo.total - memoryInfo.available) / memoryInfo.total) * 100) || 0;
            } else {
                // Fallback: Use standard used / total calculation
                memoryUsage = ((memoryInfo.used / memoryInfo.total) * 100) || 0;
            }

            // Smooth CPU readings to reduce fluctuation
            this.cpuLoadArray.push(cpuUsage);
            if (this.cpuLoadArray.length > this.maxCpuSamples) {
                this.cpuLoadArray.shift();
            }
            
            const smoothedCpu = this.cpuLoadArray.reduce((a, b) => a + b, 0) / this.cpuLoadArray.length;

            // Update cache
            this.lastStats = {
                cpu: Math.round(smoothedCpu * 10) / 10, // Round to 1 decimal
                memory: Math.round(memoryUsage * 10) / 10, // Round to 1 decimal
                timestamp: Date.now()
            };

            // Emit stats update
            this.eventEmitter.emit('system-stats', this.lastStats);

            return this.lastStats;

        } catch (error) {
            console.error('Failed to update system stats:', error);
            
            // Return cached stats on error
            return this.lastStats;
        }
    }

    /**
     * Get current system statistics
     */
    async getCurrentStats() {
        try {
            // If monitoring is active, return cached stats
            if (this.isMonitoring) {
                return this.lastStats;
            }

            // Otherwise, get fresh stats
            return await this.updateSystemStats();

        } catch (error) {
            console.error('Failed to get current stats:', error);
            throw new Error(`Stats retrieval failed: ${error.message}`);
        }
    }

    /**
     * Get detailed system information
     */
    async getDetailedSystemInfo() {
        try {
            const [
                cpu,
                memory,
                osInfo,
                system,
                diskLayout,
                networkInterfaces
            ] = await Promise.all([
                si.cpu(),
                si.mem(),
                si.osInfo(),
                si.system(),
                si.diskLayout(),
                si.networkInterfaces()
            ]);

            return {
                cpu: {
                    manufacturer: cpu.manufacturer,
                    brand: cpu.brand,
                    speed: cpu.speed,
                    cores: cpu.cores,
                    physicalCores: cpu.physicalCores,
                    processors: cpu.processors
                },
                memory: {
                    total: memory.total,
                    free: memory.free,
                    used: memory.used,
                    active: memory.active,
                    available: memory.available
                },
                os: {
                    platform: osInfo.platform,
                    distro: osInfo.distro,
                    release: osInfo.release,
                    arch: osInfo.arch,
                    hostname: osInfo.hostname
                },
                system: {
                    manufacturer: system.manufacturer,
                    model: system.model,
                    version: system.version,
                    sku: system.sku
                },
                storage: diskLayout.map(disk => ({
                    name: disk.name,
                    type: disk.type,
                    size: disk.size,
                    interfaceType: disk.interfaceType
                })),
                network: networkInterfaces.filter(iface => !iface.internal).map(iface => ({
                    iface: iface.iface,
                    type: iface.type,
                    speed: iface.speed,
                    mac: iface.mac
                }))
            };

        } catch (error) {
            console.error('Failed to get detailed system info:', error);
            throw new Error(`System info retrieval failed: ${error.message}`);
        }
    }

    /**
     * Get system performance summary
     */
    async getPerformanceSummary() {
        try {
            const [
                currentLoad,
                memory,
                processes,
                disksIO,
                networkStats
            ] = await Promise.all([
                si.currentLoad(),
                si.mem(),
                si.processes(),
                si.disksIO(),
                si.networkStats()
            ]);

            return {
                cpu: {
                    usage: currentLoad.currentLoad,
                    loadAvg: currentLoad.avgLoad,
                    cores: currentLoad.cpus.map(cpu => ({
                        load: cpu.load,
                        loadUser: cpu.loadUser,
                        loadSystem: cpu.loadSystem
                    }))
                },
                memory: {
                    usagePercent: process.platform === 'darwin' && memory.active !== undefined
                        ? (memory.active / memory.total) * 100
                        : memory.available !== undefined
                            ? ((memory.total - memory.available) / memory.total) * 100
                            : (memory.used / memory.total) * 100,
                    totalGB: Math.round(memory.total / (1024 * 1024 * 1024) * 10) / 10,
                    usedGB: Math.round((process.platform === 'darwin' ? memory.active : memory.used) / (1024 * 1024 * 1024) * 10) / 10,
                    freeGB: Math.round((memory.available || memory.free) / (1024 * 1024 * 1024) * 10) / 10
                },
                processes: {
                    running: processes.running,
                    blocked: processes.blocked,
                    sleeping: processes.sleeping,
                    top: processes.list.slice(0, 5).map(proc => ({
                        name: proc.name,
                        cpu: proc.cpu,
                        memory: proc.memory
                    }))
                },
                disk: {
                    readIOPS: disksIO.rIO,
                    writeIOPS: disksIO.wIO,
                    readSpeed: disksIO.rIO_sec,
                    writeSpeed: disksIO.wIO_sec
                },
                network: networkStats.map(stat => ({
                    iface: stat.iface,
                    rx: stat.rx_bytes,
                    tx: stat.tx_bytes,
                    rxSpeed: stat.rx_sec,
                    txSpeed: stat.tx_sec
                }))
            };

        } catch (error) {
            console.error('Failed to get performance summary:', error);
            throw new Error(`Performance summary failed: ${error.message}`);
        }
    }

    /**
     * Check if monitoring is active
     */
    isActive() {
        return this.isMonitoring;
    }

    /**
     * Update monitoring interval
     */
    updateInterval(newInterval) {
        if (newInterval < 100 || newInterval > 10000) {
            throw new Error('Interval must be between 100ms and 10000ms');
        }

        this.updateInterval = newInterval;
        
        if (this.isMonitoring) {
            // Restart monitoring with new interval
            this.stopMonitoring();
            this.startMonitoring(newInterval);
        }

        console.log(`Monitoring interval updated to ${newInterval}ms`);
    }

    /**
     * Get monitoring status
     */
    getStatus() {
        return {
            isMonitoring: this.isMonitoring,
            interval: this.updateInterval,
            lastUpdate: this.lastStats.timestamp,
            lastStats: this.lastStats
        };
    }
}

module.exports = SystemMonitor;