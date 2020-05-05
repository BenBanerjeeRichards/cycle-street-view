var RED_ICON = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

var markerLayer;
var map;
var pano;
var circleMarker;
var circleMarkerLayer;

var tcxContents = {
    "coursePoints": [],
    "trackPoints": [],
    "xmlDoc": undefined,
    "newCoursePoints": undefined
};

var elevationChart = {
    "widthPx": 0,
    "heightPx": 0,
    "elevationSvg": undefined
};

var pixelToPointIndex = [];

function error(msg) {
    alert(msg);
}


function onFileUploaded(evt) {
    var file = evt.target.files[0];
    var path = evt.target.value;
    tcxContents["fileName"] = path.split("\\").pop();

    var reader = new FileReader();
    reader.onload = function (theFile) {
        return function (e) {
            var xml = e.target.result;
            parser = new DOMParser();
            xmlDoc = parser.parseFromString(xml, "text/xml");
            if (loadTcxFile(xmlDoc)) {
                tcxContents["xmlDoc"] = xmlDoc;
                addRouteToMap();
            }
        }
    }(file);
    reader.readAsText(file)
}

function addRouteToMap() {
    var trackPoints = tcxContents["trackPoints"];

    // var coursePoints = tcxContents["coursePoints"];
    // var courseMarkers = [];
    //
    // coursePoints.forEach(function (point) {
    //     courseMarkers.push(L.marker([point["lat"], point["long"]])
    //         .bindPopup(point["instruction"]))
    // });
    //
    // var courseMarkerGroup = L.layerGroup(courseMarkers);
    // oldGroup = map.addLayer(courseMarkerGroup);
    // mapLayerGroup.addOverlay(courseMarkerGroup, "original");

    var points = [];
    trackPoints.forEach(function (trackPoint) {
        points.push(new L.LatLng(trackPoint["lat"], trackPoint["lng"]));
    });

    var routeLinePoly = new L.Polyline(points, {
        color: 'black',
        weight: 3,
        opacity: 0.5,
        smoothFactor: 1
    });

    routeLinePoly.addTo(map);
}


function loadTcxFile(xmlDoc) {
    var coursePointsXml = Array.prototype.slice.call(xmlDoc.getElementsByTagName("CoursePoint"));
    var coursePoints = [];

    if (coursePointsXml.length === 0) {
        error("Error: no cue sheet found in file. Tip: use ridewithgps.com to generate one. Strava not supported.")
        return false;
    }

    coursePointsXml.forEach(function (coursePoint) {
        var posXml = coursePoint.childNodes[5];
        var lat = parseFloat(posXml.getElementsByTagName("LatitudeDegrees")[0].textContent);
        var long = parseFloat(posXml.getElementsByTagName("LongitudeDegrees")[0].textContent);

        coursePoints.push({
            "name": coursePoint.childNodes[1].textContent,
            "lat": lat,
            "long": long,
            "node": coursePoint.childNodes[7].textContent,
            "instruction": coursePoint.childNodes[9].textContent,
            "time": coursePoint.childNodes[3].textContent
        });

    });

    var trackPointsXml = Array.prototype.slice.call(xmlDoc.getElementsByTagName("Trackpoint"));
    var points = [];
    var currentCoursePointIdx = 0;

    if (trackPointsXml.length === 0) {
        error("Error: No route found in file");
        return false;
    }

    var elevationData = [];
    trackPointsXml.forEach(function (trackPoint, i) {
        var latPart = trackPoint.childNodes[3].getElementsByTagName("LatitudeDegrees");
        var longPart = trackPoint.childNodes[3].getElementsByTagName("LongitudeDegrees");
        var lat = parseFloat(latPart[0].textContent);
        var long = parseFloat(longPart[0].textContent);
        var distance = parseFloat(trackPoint.childNodes[7].textContent);
        var elevation = parseFloat(trackPoint.childNodes[5].textContent);

        points.push({
            "lat": lat,
            "lng": long,
            "distance": distance,
            "elevation": elevation
        });

        elevationData.push([distance, elevation]);

        if (currentCoursePointIdx < coursePoints.length) {
            // Associate course point with point
            var pointTime = trackPoint.childNodes[1].textContent;
            if (coursePoints[currentCoursePointIdx]["time"] === pointTime) {
                coursePoints[currentCoursePointIdx]["pointIndex"] = i;
                currentCoursePointIdx++;
            }
        }
    });

    // Update view to something over the course
    var midPoint = coursePoints[Math.floor(coursePoints.length / 2)];
    map.setView([midPoint["lat"], midPoint["long"]], 11);

    tcxContents["coursePoints"] = coursePoints;
    tcxContents["trackPoints"] = points;

    setStreetView(points[0].lat, points[0].lng, 0);
    generateElevationSvg(elevationData);

    return true;
}

function setStreetView(lat, lng, heading) {
    console.log("Moving to ", lat, lng, heading);
    pano.setPosition({lat: lat, lng: lng});
}

function onMapClick(evt) {
    var lat = evt.latlng.lat;
    var lng = evt.latlng.lng;

    var closest = pointCloseTo(lat, lng);
    if (closest !== undefined) {
        console.log("closest = ", closest.lat, closest.lng);
        setStreetView(closest.lat, closest.lng, 0);
    }
}

function pointCloseTo(lat, lng) {
    // First do rough elimination of points far away
    var deltaLat =  0.3 * oneMileLat();
    var deltaLng =  0.3 * oneMileLong(lng);
    var possiblePoints = [];

    tcxContents["trackPoints"].forEach(function (point) {
        if (point.lat > (lat - deltaLat) && point.lat < (lat + deltaLat) &&
            point.lng > (lng - deltaLng) && point.lng < (lng + deltaLng)) {
            possiblePoints.push(point);
        }
    });

    // Here we exploit to flatness of the earth to use normal distance calculation
    var minDist = 9999999999999;
    var minPoint = undefined;
    possiblePoints.forEach(function(point)  {
        var dist = Math.sqrt(Math.pow(point.lat - lat, 2) + Math.pow(point.lng - lng, 2));
        if (dist < minDist) {
            minDist = dist;
            minPoint = point;
        }
    });

    return minPoint;
}

// These are from https://gis.stackexchange.com/questions/142326/calculating-longitude-length-in-miles
function oneMileLong(lng) {
    // Roughly compute how far 1 DD longitude is in miles
    var lngRad = lng * Math.PI / 180;
    var miles = Math.cos(lngRad) * 69.172;

    // Now determine what one mile is in degrees
    return 1 / miles;
}

function oneMileLat() {
    // Pretty good estimate
    return 1 / 69;
}

function onMapMoved() {
    var lat =  pano.getPosition().lat();
    var lng =  pano.getPosition().lng();

    // Update marker
    // First remove
    if (markerLayer !== undefined) {
        map.removeLayer(markerLayer);
    }

    markerLayer = L.layerGroup([L.marker({lat: lat, lng: lng}, {"icon": RED_ICON})]);
    map.addLayer(markerLayer);
}

function cleanElevationData(elevationData) {
    // You do sometimes get issues with elevation jumps, e.g. old Edinburgh road bridge (the A road one)
    // jumps to -3600ft
    // TODO 
}

function generateElevationSvg(elevationData) {
    var elevation = document.getElementById("elevation");
    // Width and height of DIV in pixels, as defined by window size
    var width = elevation.clientWidth;
    var height = elevation.clientHeight;
    elevationChart["widthPx"] = width;
    elevationChart["heightPx"] = height;

    var minElevation = elevationData[0][1];
    var maxElevation = elevationData[0][1];
    elevationData.forEach(function(point) {
        if (point[1] < minElevation) {
            minElevation = point[1];
        }
        if (point[1] > maxElevation) {
            maxElevation = point[1];
        }
    });

    console.log(minElevation, maxElevation, maxElevation - minElevation);
    var pixelsPerElevationM = height / (maxElevation - minElevation);
    var pixelsPerDistanceM = width /  elevationData[elevationData.length - 1][0];

    console.log("pixelsPerElevationM=", pixelsPerElevationM, "pixelsPerDistanceM=", pixelsPerDistanceM);


    var pixelScaledData = [];
    elevationData.forEach(function(point, pointIdx) {
        var distancePixels = pixelsPerDistanceM * point[0];
        var elevationPixels = height - pixelsPerElevationM * (point[1] - minElevation); // FIXME
        pixelScaledData.push([distancePixels, elevationPixels]);

        if (pointIdx > 0) {
            for (var i = Math.floor(pixelScaledData[pointIdx -1][0]); i < distancePixels; i++) {
                pixelToPointIndex[i] = pointIdx - 1;
            }
        }
    });

    var pathData = "M0 " + height;
    pixelScaledData.forEach(function(point) {
        var line = "L" + point[0] + " " + point[1] + " ";
        pathData += line;
    });

    var elevationPath = document.createElementNS("http://www.w3.org/2000/svg","path");
    elevationPath.setAttributeNS(null,"d",pathData);
    elevationPath.setAttributeNS(null,"fill","transparent");
    elevationPath.setAttributeNS(null,"stroke","lightgrey");
    var elevationSvg = document.getElementById("elevation-svg");
    elevationSvg.appendChild(elevationPath);

    drawTooltip(10, 5, 100);
    hideTooltip();

    drawVerticalLine(100);
    onMouseLeaveElevation();
}

function drawVerticalLine(x) {
    var elevationSvg = document.getElementById("elevation-svg");

    var elevationPath = document.createElementNS("http://www.w3.org/2000/svg","line");
    elevationPath.setAttributeNS(null,"id","line");
    elevationPath.setAttributeNS(null,"stroke","black");
    elevationPath.setAttributeNS(null,"x1",x);
    elevationPath.setAttributeNS(null,"x2",x);
    elevationPath.setAttributeNS(null,"y1",0);
    elevationPath.setAttributeNS(null,"y2",elevationChart["heightPx"]);
    elevationSvg.appendChild(elevationPath);
    elevationChart["verticalLine"] = elevationPath;

    return elevationPath;
}

function drawTooltip(distance, gradient) {
    var container = document.createElementNS("http://www.w3.org/2000/svg","g");

    var distanceText = document.createElementNS("http://www.w3.org/2000/svg","text");
    distanceText.setAttributeNS(null,"x",0);
    distanceText.setAttributeNS(null,"y",15 + "");
    distanceText.setAttributeNS(null,"id","distance-text");
    distanceText.appendChild(document.createTextNode(distance + " mi"));
    container.appendChild(distanceText);

    var elevationText = document.createElementNS("http://www.w3.org/2000/svg","text");
    elevationText.setAttributeNS(null,"x",0);
    elevationText.setAttributeNS(null,"y",30 + "");
    elevationText.setAttributeNS(null,"id","gradient-text");
    elevationText.appendChild(document.createTextNode(gradient + "%"));
    container.appendChild(elevationText);

    container.setAttributeNS(null,"x","0");
    container.setAttributeNS(null,"y","0");
    container.setAttributeNS(null,"id","tooltip-container");

    elevationChart["elevationSvg"].appendChild(container);
}

function setTooltipValues(distance, gradient) {
    var gradText = elevationChart["elevationSvg"].getElementById("gradient-text");
    gradText.childNodes[0].textContent = gradient + "%";

    var gradText = elevationChart["elevationSvg"].getElementById("distance-text");
    gradText.childNodes[0].textContent = distance + " mi";

}

function setTooltipPosition(x) {
    // Compute actual x
    if (x > 0.9 * elevationChart["widthPx"]) {
        x -= 70;
    } else {
        x += 10;
    }
    var container = elevationChart["elevationSvg"].getElementById("tooltip-container");
    var transformContents = "translate(" + x + ")";
    container.setAttributeNS(null, "transform", transformContents) ;
}

function hideTooltip() {
    var container = elevationChart["elevationSvg"].getElementById("tooltip-container");
    container.setAttributeNS(null, "display", "none") ;
}

function showTooltip() {
    var container = elevationChart["elevationSvg"].getElementById("tooltip-container");
    container.setAttributeNS(null, "display", "block") ;
}

function windowSizeChanged() {
}

function onElevationClick(evt) {
    var x = evt.clientX;
    var point = tcxContents["trackPoints"][pixelToPointIndex[x]];
    setStreetView(point["lat"], point["lng"], 0);
}

function onMouseLeaveElevation() {
    if (circleMarker !== undefined && circleMarkerLayer !== undefined) {
        map.removeLayer(circleMarkerLayer);
        circleMarker = undefined;
    }
    elevationChart["elevationSvg"].getElementById("line").style.display = "none";
    hideTooltip();

}

function onMouseEnterElevation() {
    elevationChart["elevationSvg"].getElementById("line").style.display = "block";
    showTooltip();
}

function onElevationHover(evt) {
    var x = evt.clientX;
    elevationChart["elevationSvg"].getElementById("line").setAttributeNS(null, "x1", ""+x);
    elevationChart["elevationSvg"].getElementById("line").setAttributeNS(null, "x2",""+ x);

    var pointIdx = pixelToPointIndex[x];
    var point = tcxContents["trackPoints"][pointIdx];
    var miles = (0.000621371 * point["distance"]).toFixed(2);

    // Compute gradient from surrounding points
    var elevationStart;
    var elevationEnd;
    var distanceStart;
    var distanceEnd;
    if (pointIdx === 0) {
        elevationStart = point["elevation"];
        distanceStart = point["distance"];
    } else {
        elevationStart = tcxContents["trackPoints"][pointIdx - 1]["elevation"];
        distanceStart = tcxContents["trackPoints"][pointIdx - 1]["distance"];
    }

    if (pointIdx === tcxContents["trackPoints"].length -1) {
        elevationEnd = point["elevation"];
        distanceEnd = point["distance"];
    } else {
        elevationEnd = tcxContents["trackPoints"][pointIdx  +1]["elevation"];
        distanceEnd = tcxContents["trackPoints"][pointIdx + 1]["distance"];
    }

    var gradient;
    if (distanceEnd - distanceStart === 0) {
        gradient = 0;
    } else {
        gradient = (100 * (elevationEnd - elevationStart) / (distanceEnd - distanceStart)).toFixed(1);
    }

    console.log(miles, gradient);

    // Draw marker on map
    if (circleMarker === undefined) {
        circleMarker = L.circleMarker({lat: point["lat"], lng: point["lng"]},
            {radius: 5, color: "black", fillColor: "black", fill: true, fillOpacity: 1});
        circleMarkerLayer = L.layerGroup([circleMarker]);
        map.addLayer(circleMarkerLayer);
    } else {
        circleMarker.setLatLng({lat: point["lat"], lng: point["lng"]})
    }

    setTooltipPosition(x);
    setTooltipValues(miles, gradient)
}

// Called by google API on load
function initialize() {
    pano = new google.maps.StreetViewPanorama(
        document.getElementById('pano'), {
            position: {lat: 51.509891, lng: -0.122515},
            pov: {
                heading: 34,
                pitch: 10
            }
        });

    pano.addListener('position_changed', onMapMoved);

    map = L.map('map').setView([55.5, -0.09], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    map.on("click", onMapClick);
    elevationChart["elevationSvg"] = document.getElementById("elevation-svg");
    document.getElementById('file').addEventListener('change', onFileUploaded, false);

    // window.addEventListener('resize', windowSizeChanged);

    var elevation = document.getElementById("elevation");
    elevation.onclick = onElevationClick;
    elevation.onmousemove = onElevationHover;

    elevation.onmouseleave = onMouseLeaveElevation;
    elevation.onmouseenter = onMouseEnterElevation;
}

window.onload = function() {
//     var ref = document.getElementsByTagName( 'script' )[ 0 ];
//
//     var script = document.createElement("src");
//     script.setAttribute("src", "https://maps.googleapis.com/maps/api/js?key=" + GOOGLE_API_KEY + "&callback=initialize")
//     script.async = true;
// // Inject the script into the DOM
//     ref.parentNode.insertBefore( script, ref );
//
//     console.log("Add script");
//
//     script.onload = function() {
//         console.log("LOADED!");
//     }
};

