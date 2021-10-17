/*
Copyright (C) 2021 Florian Klug

This file is part of TUbe-downloader.

TUbe-downloader is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

TUbe-downloader is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with TUbe-downloader.  If not, see <https://www.gnu.org/licenses/>.
*/
class OCTrack {
    constructor(url, resolution) {
        this.url = url;
        this.resolution = resolution;
    }
}


class OCEvent {
    constructor(id, title, tracks) {
        this.id = id;
        this.title = title;
        this.tracks = tracks;
    }
}


document.addEventListener('DOMContentLoaded', async () => {
    await getEvents();
    updateEventList();
});


clear_downloads_button.addEventListener('click', e => {
    removeOldDownloadsFromQueue();
})


download_checked_button.addEventListener('click', e => {
    let checkboxes = document.getElementsByClassName('download_checkbox');
    for (let checkbox of checkboxes) {
        if (checkbox.checked) {
            downloadEvent(checkbox.getAttribute('data-event'));
        }
    }
})


check_all_checkbox.addEventListener('click', e => {
    let checkboxes = document.getElementsByClassName('download_checkbox');
    for (let checkbox of checkboxes) {
        checkbox.checked = e.currentTarget.checked;
    }
});

// attaching eventlisteners to the dynamically created download
// buttons didn't work on creation, so we have to use this workaround
events_container.addEventListener('click', async e => {
    if (e.target.classList.contains('download_button')) {
        let eventId = e.target.getAttribute('data-event');
        downloadEvent(eventId);
    }
})


// Wrap saving/loading to/from local storage in a promise.
// Due to the storage api documentation get() and set()
// should return a promise when using manifest V3. But this
// doesn't work in vivaldi (yet?)
function saveToLocalStorage(items) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set(items, () => resolve());
    });
}

function loadFromLocalStorage(items) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(items, i => {
            resolve(i);
        })
    });
}

function getCurrentTab() {
    return new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (items) => {
            resolve(items[0]);
        });
    });
}

function getDownloadById(id) {
    return new Promise((resolve, reject) => {
        chrome.downloads.search({ 'id': id }, items => {
            resolve(items[0]);
        });
    });

}



function setLoadingSpinnerVisibility(v) {
    let spinner = document.getElementById('loading_spinner');
    if (v) {
        spinner.style.display = 'inline-block';
    } else {
        spinner.style.display = 'none';
    }
}


async function loadEventById(id) {
    let items = await loadFromLocalStorage({ 'currentEvents': [] });
    let currentEvents = items.currentEvents;
    for (let i = 0; i < currentEvents.length; i++) {
        if (currentEvents[i].id === id) {
            return currentEvents[i];
        }
    }
    return undefined;
}


async function getEventById(id) {
    let response = await fetch('https://tube.tugraz.at/api/events/' + id);
    return await response.json();
}


async function getEvents() {
    let ocEvents = [];
    let events = [];
    let tab = await getCurrentTab();
    const url = new URL(tab.url);
    if (url.hostname === 'tube.tugraz.at') {
        const urlParams = new URLSearchParams(url.search);
        // on a series overview page
        if (url.pathname === '/paella/ui/browse.html') {
            const seriesId = urlParams.get('series');
            let response = await fetch('https://tube.tugraz.at/api/events?sort=start_date:DESC&filter=is_part_of:' + seriesId)
            if (response.status !== 200) {
                console.log('Looks like there was a problem. Status Code: ' +
                    response.status);
                return;
            }
            events = await response.json()
        // on a single event watch page
        } else if (url.pathname === '/paella/ui/watch.html') {
            const eventId = urlParams.get('id');
            events[0] = await getEventById(eventId);
        }

        for (let i = 0; i < events.length; i++) {
            let event = events[i];
            let response = await fetch('https://tube.tugraz.at/search/episode.json?id=' + event.identifier)
            let searchResults = await response.json()
            let tracks = [];
            let JSONTracks =
                searchResults['search-results']['result']['mediapackage']['media']['track'];
            JSONTracks = JSONTracks.filter(entry => entry.mimetype == 'video/mp4');
            JSONTracks = JSONTracks.sort((first, second) => parseInt(first.video.resolution.split('x')[0]) - parseInt(second.video.resolution.split('x')[0])).reverse();
            JSONTracks.forEach(JSONTrack => {
                let track = new OCTrack(JSONTrack.url, JSONTrack.video.resolution);
                tracks.push(track);
            })
            ocEvents.push(new OCEvent(event.identifier, event.title, tracks));
        }

    }
    await saveToLocalStorage({ 'currentEvents': ocEvents });
    updateEventList();
}


async function updateEventList() {
    setLoadingSpinnerVisibility(false);
    let events = await loadFromLocalStorage({ 'currentEvents': [] });
    events = events.currentEvents;
    if (events.length === 0) {
        document.getElementById('no_events_message').style.display = 'block';
        document.getElementById('events_table').style.display = 'none';
        return;
    } else {
        document.getElementById('no_events_message').style.display = 'none';
        document.getElementById('events_table').style.display = 'block';
    }

    let html = '';
    let container = document.getElementById('events_container');
    container.innerHTML = '';
    events.forEach((event) => {
        html += '<tr><td><select id="tracks_' + event.id + '">';
        event.tracks.forEach(media => {
            html += '<option value="' + media.url + '">' + media.resolution + '</option>'
        });
        html += '</select></td><td>' + event.title + '</td><td><button class="download_button" data-event="' + event.id + '">Download</button></td><td><input type="checkbox" class="download_checkbox" data-event="' + event.id + '"></td></tr>';

    });
    container.innerHTML += html;
}


async function removeOldDownloadsFromQueue() {
    let items = await loadFromLocalStorage({ 'downloadQueue': [] });
    let dq = items['downloadQueue'];
    let newDownloadQueue = [];
    let progressTable = document.getElementById('progress_bars');
    progressTable.innerHTML = '';
    for (let i = 0; i < dq.length; i++) {
        let dlItem = await getDownloadById(dq[i].downloadId);
        if (dlItem.state === 'in_progress') {
            newDownloadQueue.push({ 'downloadId': dlItem.id, event: dq[i].event });
        }
    }
    await saveToLocalStorage({ 'downloadQueue': newDownloadQueue });
}


function updateProgressBar(dlItem, event) {
    let pb = document.getElementById('progress_bar_' + event.id);
    // if the progress bar for the event is not in dom yet,
    // create a new one and add it to the table containing all progress bars
    if (!pb) {
        let progressTable = document.getElementById('progress_bars');
        let html = '';
        html += '<tr><td><div id="progress_bar_' + event.id + '" class="progress_bar"></div></td></tr>';
        progressTable.innerHTML += html;
        pb = document.getElementById('progress_bar_' + event.id);
    }

    pbWidth = pb.offsetWidth;

    if (dlItem.state === 'in_progress') {
        pb.classList.remove('finished', 'error');
        if (dlItem.totalBytes && dlItem.bytesReceived) {
            let ratio = dlItem.bytesReceived / dlItem.totalBytes;
            //pb.style.backgroundImage = 'linear-gradient(to left, white, white)';
            //pb.style.backgroundRepeat = 'no-repeat';
            pb.style.backgroundPosition = ratio * pbWidth + 'px 0px';
            pb.innerHTML = event.title + ' - ' + (ratio * 100).toFixed(2) + '%';
        } else {
            pb.innerHTML = event.title + ' - ' + dlItem.bytesReceived + ' Bytes received so far';
        }
    } else if (dlItem.state === 'complete') {
        pb.classList.add('finished');
        pb.style.backgroundPosition = '';
        pb.innerHTML = event.title + ' - ' + '100%';
    } else {
        pb.classList.add('error');
        pb.style.backgroundPosition = '';
        pb.innerHTML = event.title + ' - Download failed';
    }
}


async function updateDownloads() {
    let items = await loadFromLocalStorage({ 'downloadQueue': [] });
    let dq = items['downloadQueue'];
    dq.forEach((queueItem) => {
        chrome.downloads.search({ 'id': queueItem.downloadId }, items => {
            let dlItem = items[0];
            updateProgressBar(dlItem, queueItem.event);
        });
    });
    window.setTimeout(updateDownloads, 1000);
}


function downloadEvent(eventId) {
    let select = document.getElementById('tracks_' + eventId);
    trackURL = select.options[select.selectedIndex].value;
    chrome.downloads.download({ url: trackURL }, downloadId => {
        chrome.storage.local.get({ 'downloadQueue': [] }, async (items) => {
            let dq = items['downloadQueue'];
            let event = await loadEventById(eventId);
            let queueItem = { downloadId, event };
            dq.push(queueItem);
            chrome.storage.local.set({ 'downloadQueue': dq }, updateDownloads);
        });
    });
}


window.setTimeout(updateDownloads, 1000);